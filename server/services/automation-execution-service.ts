import { db } from "../db";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { sql } from "drizzle-orm";
import {
  automations,
  automationNodes,
  automationExecutions,
  automationExecutionLogs,
  automationEdges,
  contacts,
  messages,
  templates,
  channels,
  groups,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendBusinessMessage } from "../services/messageService";
import { WhatsAppApiService } from "./whatsapp-api";
import { storage } from "server/storage";
import { randomUUID } from "crypto";

interface ExecutionContext {
  executionId: string;
  automationId: string;
  contactId?: string;
  conversationId?: string;
  variables: Record<string, any>;
  triggerData: any;
  lastUserMessage?: string; 
}

interface PendingExecution {
  executionId: string;
  automationId: string;
  nodeId: string;
  conversationId: string;
  contactId?: string;
  context: ExecutionContext;
  saveAs?: string;
  timestamp: Date;
  status: 'waiting_for_response';
  expectedButtons?: any[];
}

export class AutomationExecutionService {
  private pendingExecutions = new Map<string, PendingExecution>();

  
  async executeAutomation(executionId: string) {
    console.log(`Starting execution: ${executionId}`);
    
    try {
      
      const execution = await db.query.automationExecutions.findFirst({
        where: eq(automationExecutions.id, executionId),
      });

      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      
      const automation = await this.getAutomationWithFlow(execution.automationId);
      if (!automation) {
        throw new Error(`Automation ${execution.automationId} not found`);
      }

      
      await db.update(automations)
        .set({ 
          executionCount: automation.executionCount !== null ? automation.executionCount + 1 : null,
          lastExecutedAt: new Date()
        })
        .where(eq(automations.id, execution.automationId));

      
      const triggerData = execution.triggerData ?? {};

      const context: ExecutionContext = {
        executionId: execution.id,
        automationId: execution.automationId,
        contactId: execution.contactId ?? undefined,
        conversationId: execution.conversationId ?? undefined,
        variables: {
          contactId: execution.contactId ?? undefined,
          conversationId: execution.conversationId ?? undefined,
          ...triggerData
        },
        triggerData,
        lastUserMessage:
          (execution.triggerData as { message?: { content?: string; text?: string } }).message
            ?.content ||
          (execution.triggerData as { message?: { content?: string; text?: string } }).message
            ?.text ||
          "",
    };

      
      const firstNode = automation.nodes.find(
        (n: any) => !automation.edges.some((e: any) => e.targetNodeId === n.nodeId)
      );

      if (firstNode) {
        await this.executeNode(firstNode, automation, context);
      } else {
        await this.completeExecution(executionId, 'completed', 'No start node found');
      }

    } catch (error) {
      console.error(`Error executing automation ${executionId}:`, error);
      await this.completeExecution(executionId, 'failed',  (error as Error).message);
      throw error;
    }
  }

  
  private async executeNode(node: any, automation: any, context: ExecutionContext) {
    const startTime = new Date();
    console.log(`Executing node ${node.nodeId} (${node.type})`);

    try {
      
      await this.logNodeExecution(
        context.executionId,
        node.nodeId,
        node.type,
        'running',
        node.data,
        null,
        null
      );

      let result: any = null;

      
      switch (node.type) {
        case 'custom_reply':
          result = await this.executeCustomReply(node, context);
          break;
          
        case 'user_reply':
          result = await this.executeUserReply(node, context);
          break;
          
        case 'time_gap':
          result = await this.executeTimeGap(node, context);
          return; 
          
        case 'send_template':
          result = await this.executeSendTemplate(node, context);
          break;
          
        case 'assign_user':
          result = await this.executeAssignUser(node, context);
          break;

        case 'conditions':
          result = await this.executeConditions(node, automation, context);
          return; 

        case 'add_to_group':
          result = await this.executeAddToGroup(node, context);
          break;

        case 'update_contact':
          result = await this.executeUpdateContact(node, context);
          break;

        case 'set_variable':
          result = await this.executeSetVariable(node, context);
          break;

        case 'send_location':
          result = await this.executeSendLocation(node, context);
          break;

        case 'send_list_message':
          result = await this.executeSendListMessage(node, context);
          break;

        case 'send_media':
          result = await this.executeSendMedia(node, context);
          break;

        case 'mark_as_read':
          result = await this.executeMarkAsRead(node, context);
          break;

        case 'webhook':
          result = await this.executeWebhook(node, context);
          break;

        case 'end':
          result = { action: 'flow_ended' };
          break;
          
        default:
          throw new Error(`Unknown node type: ${node.type}`);
      }

      
      await this.logNodeExecution(
        context.executionId,
        node.nodeId,
        node.type,
        'completed',
        node.data,
        result,
        null
      );

      if (result?.action === 'execution_paused') {
        console.log(`⏸️  Node ${node.nodeId} paused execution, not continuing to next node`);
        return;
      }

      
      await this.continueToNextNode(node, automation, context);

    } catch (error) {
      console.error(`Error executing node ${node.nodeId}:`, error);
      
      
      await this.logNodeExecution(
        context.executionId,
        node.nodeId,
        node.type,
        'failed',
        node.data,
        null,
        (error as Error).message
      );

      
      await this.completeExecution(context.executionId, 'failed', `Node ${node.nodeId} failed: ${ (error as Error).message}`);
      throw error;
    }
  }

  

  
private normalizeText(text: string = ""): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/gi, "")   
    .replace(/\s+/g, " ")
    .trim();
}

private stemWord(word: string = ""): string {
  return word
    .replace(/ing$|ed$|s$/g, "")   
    .trim();
}

  private async executeConditions(node: any, automation: any, context: ExecutionContext) {
    const conditionData = node.data;
    const conditionType = conditionData.conditionType || 'keyword';
    const matchType = conditionData.matchType || 'any';
    const keywords = conditionData.keywords || [];

    console.log(`🔍 Evaluating condition: ${conditionType}, match: ${matchType}, keywords: ${keywords.join(', ')}`);

    let conditionMet = false;
    let matchedKeyword = null;
    let userInput = context.lastUserMessage || '';

    
  const lowerInput = this.normalizeText(userInput);
  const lowerKeywords = keywords.map((k: string) =>
    this.normalizeText(k)
  );

    switch (conditionType) {

 case "keyword":
    if (matchType === "any") {
      conditionMet = lowerKeywords.some(k =>
        lowerInput.includes(k)
      );
    } 
    else if (matchType === "all") {
      conditionMet = lowerKeywords.every(k =>
        lowerInput.includes(k)
      );
    }
    else if (matchType === "exact") {
      conditionMet = lowerKeywords.includes(lowerInput);
    }
    break;

  
  
  
  case "equals":
    conditionMet = lowerKeywords.some(k =>
      lowerInput === k ||
      this.stemWord(lowerInput) === this.stemWord(k)
    );

    matchedKeyword = conditionMet ? lowerInput : null;
    break;

  
  
  
  case "starts_with":
    conditionMet = lowerKeywords.some(k =>
      lowerInput.startsWith(k) ||
      this.stemWord(lowerInput).startsWith(this.stemWord(k))
    );

    matchedKeyword = conditionMet
      ? lowerKeywords.find(k =>
          lowerInput.startsWith(k) ||
          this.stemWord(lowerInput).startsWith(this.stemWord(k))
        )
      : null;

    break;

  
  
  
  case "contains":
    conditionMet = lowerKeywords.some(k =>
      lowerInput.includes(k) ||
      this.stemWord(lowerInput).includes(this.stemWord(k))
    );

    matchedKeyword = conditionMet
      ? lowerKeywords.find(k =>
          lowerInput.includes(k) ||
          this.stemWord(lowerInput).includes(this.stemWord(k))
        )
      : null;

    break;

  
  
  
  case "regex":
    try {
      const pattern = new RegExp(keywords[0] || "", "i");
      conditionMet = pattern.test(userInput);
      matchedKeyword = conditionMet ? keywords[0] : null;
    } catch {
      console.error("Invalid regex pattern:", keywords[0]);
    }
    break;

  
  
  
  case "variable":
    const variableCondition = keywords[0] || "";
    conditionMet = this.evaluateVariableCondition(
      variableCondition,
      context.variables
    );
    matchedKeyword = conditionMet ? variableCondition : null;
    break;

  default:
    console.warn(`Unknown condition type: ${conditionType}`);
}

    
    context.variables.lastConditionResult = conditionMet;
    context.variables.matchedKeyword = matchedKeyword;

    const result = {
      conditionMet,
      matchedKeyword,
      userInput,
      conditionType,
      matchType,
      keywords
    };

    
    await this.logNodeExecution(
      context.executionId,
      node.nodeId,
      node.type,
      'completed',
      conditionData,
      result,
      null
    );

    console.log(`🎯 Condition ${conditionMet ? 'MET' : 'NOT MET'}: "${matchedKeyword || 'none'}"`);

    
    await this.routeFromCondition(node, automation, context, conditionMet);

    return result;
  }

  
  private async routeFromCondition(
    conditionNode: any, 
    automation: any, 
    context: ExecutionContext, 
    conditionMet: boolean
  ) {
    
    const outgoingEdges = automation.edges.filter(
      (e: any) => e.sourceNodeId === conditionNode.nodeId
    );

    if (outgoingEdges.length === 0) {
      console.log(`⚠️  No outgoing edges from condition node ${conditionNode.nodeId}`);
      await this.completeExecution(context.executionId, 'completed', 'Condition evaluated but no next steps defined');
      return;
    }

    
    
    if (conditionMet) {
      
      const trueEdge = outgoingEdges[0];
      const nextNode = automation.nodes.find((n: any) => n.nodeId === trueEdge.targetNodeId);
      
      if (nextNode) {
        console.log(`➡️  Condition TRUE: Following path to ${nextNode.type} node`);
        await this.executeNode(nextNode, automation, context);
      } else {
        console.warn(`Node ${trueEdge.targetNodeId} not found for TRUE path`);
        await this.completeExecution(context.executionId, 'completed', 'TRUE path node not found');
      }
    } else {
      
      if (outgoingEdges.length > 1) {
        const falseEdge = outgoingEdges[1];
        const nextNode = automation.nodes.find((n: any) => n.nodeId === falseEdge.targetNodeId);
        
        if (nextNode) {
          console.log(`➡️  Condition FALSE: Following alternative path to ${nextNode.type} node`);
          await this.executeNode(nextNode, automation, context);
        } else {
          console.warn(`Node ${falseEdge.targetNodeId} not found for FALSE path`);
          await this.completeExecution(context.executionId, 'completed', 'FALSE path node not found');
        }
      } else {
        
        console.log(`🛑 Condition FALSE: No alternative path defined, ending execution`);
        await this.completeExecution(context.executionId, 'completed', 'Condition not met and no alternative path');
      }
    }
  }

  
  private evaluateVariableCondition(condition: string, variables: Record<string, any>): boolean {
    try {
      
      const resolvedCondition = this.replaceVariables(condition, variables);
      
      
      
      
      
      if (resolvedCondition.includes('===')) {
        const [left, right] = resolvedCondition.split('===').map(s => s.trim().replace(/['"]/g, ''));
        return left === right;
      }
      
      if (resolvedCondition.includes('!==')) {
        const [left, right] = resolvedCondition.split('!==').map(s => s.trim().replace(/['"]/g, ''));
        return left !== right;
      }
      
      if (resolvedCondition.includes('contains')) {
        const [left, right] = resolvedCondition.split('contains').map(s => s.trim().replace(/['"]/g, ''));
        return left.toLowerCase().includes(right.toLowerCase());
      }
      
      
      return Boolean(resolvedCondition);
      
    } catch (error) {
      console.error('Error evaluating variable condition:', error);
      return false;
    }
  }

  
  private async continueToNextNode(currentNode: any, automation: any, context: ExecutionContext) {
    
    const outgoingEdges = automation.edges.filter(
      (e: any) => e.sourceNodeId === currentNode.nodeId
    );

    if (outgoingEdges.length === 0) {
      
      await this.completeExecution(context.executionId, 'completed', 'All nodes executed successfully');
      return;
    }

    
    for (const edge of outgoingEdges) {
      const nextNode = automation.nodes.find((n: any) => n.nodeId === edge.targetNodeId);
      if (nextNode) {
        await this.executeNode(nextNode, automation, context);
      }
    }
  }

  
  
  
  

  
  
  

  
  
  
  
  
  
  
    
  
    
  
  
  
  
  
  

  
  async handleUserResponse(conversationId: string, userResponse: string, interactiveData?: any) {
    console.log(`📨 Received user response for conversation ${conversationId}: "${userResponse}"`);
    
    
    const pendingExecution = this.findPendingExecutionByConversation(conversationId);
    if (!pendingExecution) {
      console.warn(`No pending execution found for conversation ${conversationId}`);
      return null;
    }

    try {
      
      this.pendingExecutions.delete(pendingExecution.pendingId);
      
      
      let processedResponse = userResponse;
      let selectedButtonId = null;
      
      
      if (interactiveData && interactiveData.type === 'button_reply') {
        selectedButtonId = interactiveData.button_reply.id;
        processedResponse = interactiveData.button_reply.title;
        console.log(`🔘 Button clicked: ${selectedButtonId} - "${processedResponse}"`);
      } else if (pendingExecution.expectedButtons && pendingExecution.expectedButtons.length > 0) {
        
        const matchedButton = this.matchTextToButton(userResponse, pendingExecution.expectedButtons);
        if (matchedButton) {
          selectedButtonId = matchedButton.id;
          processedResponse = matchedButton.text;
          console.log(`🎯 Matched text "${userResponse}" to button: ${selectedButtonId} - "${processedResponse}"`);
        }
      }
      
      
      const context = pendingExecution.context;
      context.lastUserMessage = processedResponse; 
      
      if (pendingExecution.saveAs) {
        context.variables[pendingExecution.saveAs] = processedResponse;
        
        
        if (selectedButtonId) {
          context.variables[`${pendingExecution.saveAs}_button_id`] = selectedButtonId;
        }
        
        console.log(`💾 Saved user response to variable: ${pendingExecution.saveAs} = "${processedResponse}"`);
      }

      
      await this.logNodeExecution(
        context.executionId,
        pendingExecution.nodeId,
        'user_reply',
        'completed',
        { question: 'User response received', interactiveData },
        { 
          userResponse: processedResponse, 
          selectedButtonId,
          savedAs: pendingExecution.saveAs 
        },
        null
      );

      
      await db.update(automationExecutions)
        .set({
          status: 'running',
          result: null
        })
        .where(eq(automationExecutions.id, context.executionId));

      console.log(`▶️  Resuming execution ${context.executionId} with user response`);

      
      const automation = await this.getAutomationWithFlow(context.automationId);
      if (!automation) {
        throw new Error(`Automation ${context.automationId} not found during resume`);
      }

      const currentNode = automation.nodes.find((n: any) => n.nodeId === pendingExecution.nodeId);
      if (currentNode) {
        await this.continueToNextNode(currentNode, automation, context);
      } else {
        throw new Error(`Node ${pendingExecution.nodeId} not found during resume`);
      }

      return {
        success: true,
        executionId: context.executionId,
        userResponse: processedResponse,
        selectedButtonId,
        savedVariable: pendingExecution.saveAs,
        resumedAt: new Date()
      };

    } catch (error) {
      console.error(`Error resuming execution for conversation ${conversationId}:`, error);
      
      await this.completeExecution(
        pendingExecution.executionId, 
        'failed', 
        `Failed to resume after user response: ${ (error as Error).message}`
      );
      
      throw error;
    }
  }

  
private async executeCustomReply(node: any, context: ExecutionContext) {
  const message = this.replaceVariables(node.data.message || '', context.variables);
  const nodeData = node.data;
  
  console.log(`Sending message to conversation ${context.conversationId}: "${message}"`);

  const getContact = await db.query.contacts.findFirst({
    where: eq(contacts?.id!, context.contactId!),
  });

  if (!getContact?.phone) {
    throw new Error('Contact phone number not found');
  }

  
  const hasMedia = nodeData.imageFile || nodeData.videoFile || nodeData.audioFile || nodeData.documentFile;
  
  const buttons = nodeData.buttons || [];

  if (hasMedia) {
    await this.sendMediaMessage(getContact, nodeData, message, context);
  }

  if (!getContact?.channelId) {
    throw new Error('channelId not found');
  }

  if (buttons.length > 0) {
    await this.sendInteractiveMessage(
      getContact.phone,
      hasMedia ? "Please choose an option:" : message,
      buttons,
      getContact.channelId,
      context.conversationId
    );

    const pendingId = `${context.executionId}_${node.nodeId}_${Date.now()}`;

    if (!context.conversationId) {
      throw new Error('conversationId is required to wait for user response');
    }

    const pendingExecution: PendingExecution = {
      executionId: context.executionId,
      automationId: context.automationId,
      nodeId: node.nodeId,
      conversationId: context.conversationId,
      contactId: context.contactId,
      context: { ...context },
      saveAs: node.data.saveAs,
      timestamp: new Date(),
      status: 'waiting_for_response',
      expectedButtons: buttons
    };

    this.pendingExecutions.set(pendingId, pendingExecution);

    await db.update(automationExecutions)
      .set({
        status: 'paused',
        result: `Waiting for button response to: "${message}"`
      })
      .where(eq(automationExecutions.id, context.executionId));

    await this.logNodeExecution(
      context.executionId,
      node.nodeId,
      node.type,
      'waiting_for_response',
      { ...node.data, message, buttons },
      { pendingId, action: 'interactive_message_sent_waiting' },
      null
    );

    console.log(`✅ Interactive message sent: ${message} with ${buttons.length} buttons`);
    console.log(`⏸️  Execution paused. Waiting for button response (pending ID: ${pendingId})`);

    return {
      action: 'execution_paused',
      message,
      buttons,
      hasMedia,
      conversationId: context.conversationId,
      pendingId,
      saveAs: node.data.saveAs
    };
  } else if (!hasMedia) {
    await sendBusinessMessage({
      to: getContact.phone,
      message,
      channelId: getContact.channelId,
    });
  }
  
  console.log(`✅ Message sent: ${message}`);
  
  return {
    action: 'message_sent',
    message,
    conversationId: context.conversationId,
    hasMedia
  };
}

private async sendMediaMessage(contact: any, nodeData: any, caption: string, context: ExecutionContext) {
  try {
    
    const channel = await storage.getChannel(contact.channelId);
    if (!channel) {
      throw new Error(`Channel ${contact.channelId} not found`);
    }

    const whatsappApi = new WhatsAppApiService(channel);
    const formattedPhone = this.formatPhoneNumber(contact.phone);
    
    let mediaPayload: any = {
      messaging_product: "whatsapp",
      to: formattedPhone,
    };

    
    if (nodeData.imageFile) {
      mediaPayload.type = "image";
      mediaPayload.image = {
        link: await this.getPublicMediaUrl(nodeData.imageFile.path),
        caption: caption || undefined
      };
    } else if (nodeData.videoFile) {
      mediaPayload.type = "video";
      mediaPayload.video = {
        link: await this.getPublicMediaUrl(nodeData.videoFile.path),
        caption: caption || undefined
      };
    } else if (nodeData.audioFile) {
      mediaPayload.type = "audio";
      mediaPayload.audio = {
        link: await this.getPublicMediaUrl(nodeData.audioFile.path)
      };
      
      if (caption) {
        
        await this.sendTextMessage(whatsappApi, formattedPhone, caption);
      }
    } else if (nodeData.documentFile) {
      mediaPayload.type = "document";
      mediaPayload.document = {
        link: await this.getPublicMediaUrl(nodeData.documentFile.path),
        filename: nodeData.documentFile.filename,
        caption: caption || undefined
      };
    }
    
    const response = await fetch(
      `https://graph.facebook.com/v24.0/${channel.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${channel.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(mediaPayload)
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('WhatsApp Media API Error:', error);
      throw new Error(error.error?.message || 'Failed to send media message');
    }

    const result = await response.json();
    
    
    await this.saveMediaMessage(contact, nodeData, caption, context, result);
    
    console.log(`✅ Media message sent successfully to ${contact.phone}`);
    return result;

  } catch (error) {
    console.error('Error sending media message:', error);
    
    
    const fallbackMessage = `${caption}\n\n[Media file: ${this.getMediaFileName(nodeData)}]`;
    await sendBusinessMessage({
      to: contact.phone,
      message: fallbackMessage,
      channelId: contact.channelId,
    });
    
    throw error;
  }
}

private async executeUserReply(node: any, context: ExecutionContext) {
  const question = this.replaceVariables(node.data.question || '', context.variables);
  const buttons = node.data.buttons || [];
  const nodeData = node.data;
  
  console.log(`Asking question to conversation ${context.conversationId}: "${question}"`);
  console.log('Question buttons:', buttons);
  
  
  const getContact = await db.query.contacts.findFirst({
    where: eq(contacts?.id!, context.contactId!),
  });

  if (!getContact?.phone) {
    throw new Error('Contact phone number not found');
  }

  
  const hasMedia = nodeData.imageFile || nodeData.videoFile || nodeData.audioFile || nodeData.documentFile;
  
  if (hasMedia) {
    
    await this.sendMediaMessage(getContact, nodeData, question, context);
  }

  if (!getContact?.channelId) {
    throw new Error('channelId not found');
  }

  
  if (buttons.length > 0) {
    
    await this.sendInteractiveMessage(
      getContact.phone,
      hasMedia ? "Please choose an option:" : question, 
      buttons,
      getContact.channelId,
      context.conversationId
    );
  } else if (!hasMedia) {
    
    await sendBusinessMessage({
      to: getContact.phone,
      message: question,
      channelId: getContact.channelId,
      conversationId: context.conversationId,
    });
  }
  
  
  const pendingId = `${context.executionId}_${node.nodeId}_${Date.now()}`;
  
  if (!context.conversationId) {
    throw new Error('conversationId is required to wait for user response');
  }
  
  const pendingExecution: PendingExecution = {
    executionId: context.executionId,
    automationId: context.automationId,
    nodeId: node.nodeId,
    conversationId: context.conversationId,
    contactId: context.contactId,
    context: { ...context },
    saveAs: node.data.saveAs,
    timestamp: new Date(),
    status: 'waiting_for_response',
    expectedButtons: buttons
  };
  
  this.pendingExecutions.set(pendingId, pendingExecution);
  
  
  await db.update(automationExecutions)
    .set({
      status: 'paused',
      result: `Waiting for user response to: "${question}"`
    })
    .where(eq(automationExecutions.id, context.executionId));
  
  
  await this.logNodeExecution(
    context.executionId,
    node.nodeId,
    node.type,
    'waiting_for_response',
    { ...node.data, question, buttons, hasMedia },
    { pendingId, action: 'interactive_question_sent' },
    null
  );
  
  console.log(`✅ Interactive question sent: ${question} with ${buttons.length} buttons and media: ${hasMedia}`);
  console.log(`⏸️  Execution paused. Waiting for user response (pending ID: ${pendingId})`);
  
  return {
    action: 'execution_paused',
    question,
    buttons,
    hasMedia,
    conversationId: context.conversationId,
    pendingId,
    saveAs: node.data.saveAs
  };
}

private async sendTextMessage(whatsappApi: any, to: string, message: string) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: message }
  };

  const response = await fetch(
    `https://graph.facebook.com/v24.0/${whatsappApi.channel.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${whatsappApi.channel.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to send text message');
  }

  return await response.json();
}

private async getPublicMediaUrl(relativePath: string): Promise<string> {
  const baseUrl = process.env.APP_URL || ("" ? `https://${""}` : 'https://oursaas.oursaas.in');
  const cleanPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
  return `${baseUrl}/${cleanPath}`;
}

private async saveMediaMessage(
  contact: any, 
  nodeData: any, 
  caption: string, 
  context: ExecutionContext, 
  whatsappResult: any
) {
  try {
    
    let messageType = 'text';
    let messageContent = caption;
    let metadata: any = {};

    if (nodeData.imageFile) {
      messageType = 'image';
      metadata = {
        mediaType: 'image',
        mediaPath: nodeData.imageFile.path,
        fileName: nodeData.imageFile.filename,
        fileSize: nodeData.imageFile.size,
        mimeType: nodeData.imageFile.mimetype
      };
    } else if (nodeData.videoFile) {
      messageType = 'video';
      metadata = {
        mediaType: 'video',
        mediaPath: nodeData.videoFile.path,
        fileName: nodeData.videoFile.filename,
        fileSize: nodeData.videoFile.size,
        mimeType: nodeData.videoFile.mimetype
      };
    } else if (nodeData.audioFile) {
      messageType = 'audio';
      metadata = {
        mediaType: 'audio',
        mediaPath: nodeData.audioFile.path,
        fileName: nodeData.audioFile.filename,
        fileSize: nodeData.audioFile.size,
        mimeType: nodeData.audioFile.mimetype
      };
    } else if (nodeData.documentFile) {
      messageType = 'document';
      metadata = {
        mediaType: 'document',
        mediaPath: nodeData.documentFile.path,
        fileName: nodeData.documentFile.filename,
        fileSize: nodeData.documentFile.size,
        mimeType: nodeData.documentFile.mimetype
      };
    }

    
    if (!context.conversationId) {
      console.warn('No conversationId in context, cannot save media message');
      return;
    }
    const conversation = await storage.getConversation(context.conversationId);
    if (!conversation) {
      console.warn('Conversation not found for media message');
      return;
    }

    console.log(`Saving ${messageType} message to conversation ${conversation.id}`);

    
    const createdMessage = await storage.createMessage({
      conversationId: conversation.id,
      content: messageContent,
      status: "sent",
      whatsappMessageId: whatsappResult.messages?.[0]?.id,
      messageType,
      metadata: JSON.stringify(metadata),
      mediaUrl: await this.getPublicMediaUrl(metadata.mediaPath || ''),
    });

    
    await storage.updateConversation(conversation.id, {
      lastMessageAt: new Date(),
      lastMessageText: messageContent || `[${messageType}]`,
    });

    
    if ((global as any).broadcastToConversation) {
      (global as any).broadcastToConversation(conversation.id, {
        type: "new-message",
        message: createdMessage,
      });
    }

  } catch (error) {
    console.error('Error saving media message to database:', error);
  }
}

private getMediaFileName(nodeData: any): string {
  if (nodeData.imageFile) return nodeData.imageFile.filename;
  if (nodeData.videoFile) return nodeData.videoFile.filename;
  if (nodeData.audioFile) return nodeData.audioFile.filename;
  if (nodeData.documentFile) return nodeData.documentFile.filename;
  return 'media file';
}

private async sendInteractiveMessage(
  to: string, 
  question: string, 
  buttons: any[], 
  channelId: string, 
  conversationId?: string
) {
  try {
    
    const channel = await storage.getChannel(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    
    const interactivePayload = {
      messaging_product: "whatsapp",
      to: this.formatPhoneNumber(to),
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: question
        },
        action: {
          buttons: buttons.slice(0, 3).map((btn, index) => ({
            type: "reply",
            reply: {
              id: btn.id || `btn_${index}`,
              title: btn.text?.substring(0, 20) || `Option ${index + 1}`
            }
          }))
        }
      }
    };

    
    const whatsappApi = new WhatsAppApiService(channel);
    const result = await this.sendInteractiveMessageDirect(whatsappApi, interactivePayload);

    
    const messageContent = `${question}\n\nOptions:\n${buttons.map((btn, i) => `${i + 1}. ${btn.text}`).join('\n')}`;
    
    
    const conversation = conversationId
      ? await storage.getConversation(conversationId)
      : await storage.getConversationByPhone(to);

    if (conversation) {
      
      const createdMessage = await storage.createMessage({
        conversationId: conversation.id,
        content: messageContent,
        status: "sent",
        whatsappMessageId: result.messages?.[0]?.id,
        messageType: "interactive",
        metadata: JSON.stringify({ buttons, interactiveType: "button" })
      });

      
      await storage.updateConversation(conversation.id, {
        lastMessageAt: new Date(),
        lastMessageText: question,
      });

      
      if ((global as any).broadcastToConversation) {
        (global as any).broadcastToConversation(conversation.id, {
          type: "new-message",
          message: createdMessage,
        });
      }
    }

    console.log(`✅ Interactive message sent successfully to ${to}`);
    return result;

  } catch (error) {
    console.error('Error sending interactive message:', error);
    
    
    console.log('📱 Falling back to text message with options...');
    const fallbackMessage = `${question}\n\nReply with:\n${buttons.map((btn, i) => `${i + 1}. ${btn.text}`).join('\n')}`;
    
    return await sendBusinessMessage({
      to,
      message: fallbackMessage,
      channelId,
      conversationId
    });
  }
}

  private async sendInteractiveMessageDirect(whatsappApi: any, payload: any) {
    const response = await fetch(
      `https://graph.facebook.com/v24.0/${whatsappApi.channel.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${whatsappApi.channel.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('WhatsApp API Error:', error);
      throw new Error(error.error?.message || 'Failed to send interactive message');
    }

    return await response.json();
  }

  private matchTextToButton(text: string, buttons: any[]) {
    const lowerText = text.toLowerCase().trim();
    
    
    let match = buttons.find(btn => btn.text.toLowerCase() === lowerText);
    if (match) return match;
    
    
    const numberMatch = lowerText.match(/^(\d+)$/);
    if (numberMatch) {
      const index = parseInt(numberMatch[1]) - 1;
      if (index >= 0 && index < buttons.length) {
        return buttons[index];
      }
    }
    
    
    match = buttons.find(btn => 
      btn.text.toLowerCase().includes(lowerText) || 
      lowerText.includes(btn.text.toLowerCase())
    );
    
    return match;
  }

  private formatPhoneNumber(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned;
  }

  private findPendingExecutionByConversation(conversationId: string) {
    for (const [pendingId, execution] of this.pendingExecutions.entries()) {
      if (execution.conversationId === conversationId) {
        return { pendingId, ...execution };
      }
    }
    
    return null;
  }

  private async executeTimeGap(node: any, context: ExecutionContext, automation?: any) {
    const delay = node.data?.delay || 60;
    console.log(`⏳ Delaying execution by ${delay} seconds`);
    
    
    setTimeout(async () => {
      try {
        console.log(`⏰ Delay completed, continuing execution`);
        
        
        const freshAutomation = await this.getAutomationWithFlow(context.automationId);
        await this.continueToNextNode(node, freshAutomation, context);
      } catch (error) {
        console.error('Error continuing after delay:', error);
        await this.completeExecution(context.executionId, 'failed', `Delay continuation failed: ${ (error as Error).message}`);
      }
    }, delay * 1000);

    return {
      action: 'delay_started',
      delay,
      scheduledFor: new Date(Date.now() + delay * 1000)
    };
  }

private getBodyParamCount(body: string): number {
  if (!body) return 0;
  const matches = body.match(/\{\{\d+\}\}/g);
  return matches ? matches.length : 0;
}

private async executeSendTemplate(node: any, context: ExecutionContext) {
  const templateId = node.data?.templateId;
  const headerImageId = node.data?.headerImageId || null;
  const variableMapping = node.data?.variableMapping || {};

  if (!templateId) throw new Error("No template ID provided");
  if (!context.contactId) throw new Error("No contactId in context");

  
  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.id, context.contactId),
  });

  if (!contact?.phone) throw new Error("Contact phone not found");
  if (!contact.channelId) throw new Error("Contact channelId missing");

  
  const [firstName = "", lastName = ""] = (contact.name || "").split(" ");

  
  const template = await db.query.templates.findFirst({
    where: and(
      eq(templates.id, templateId),
      eq(templates.channelId, contact.channelId)
    ),
  });

  if (!template) throw new Error("Template not found");

  console.log(`📄 Sending template ${template.name} to ${contact.phone}`);

  
  const bodyParamCount = this.getBodyParamCount(template.body);
  const parameters: string[] = [];

  for (let i = 1; i <= bodyParamCount; i++) {
    const mapping = variableMapping[i] || {};
    let value = "";

    switch (mapping.type) {
      case "firstName":
        value = firstName;
        break;
      case "lastName":
        value = lastName;
        break;
      case "fullName":
        value = contact.name || "";
        break;
      case "phone":
        value = contact.phone || "";
        break;
      case "custom":
        value = mapping.value || "";
        break;
      default:
        value = "";
    }

    parameters.push(value);
  }

  console.log(`📦 Prepared variables for template:`, parameters);

  
  await sendBusinessMessage({
    to: contact.phone,
    channelId: contact.channelId,
    templateName: template.name,
    parameters, 
    mediaId: headerImageId || template.mediaUrl || null, 
  });

  console.log(`✅ Template sent successfully: ${template.name}`);

  return {
    action: "template_sent",
    templateId,
    parameters,
  };
}

  private async executeAssignUser(node: any, context: ExecutionContext) {
    const assigneeId = node.data?.assigneeId;
    
    if (!assigneeId) {
      throw new Error('No assignee ID provided');
    }
    
    console.log(`👤 Assigning conversation ${context.conversationId} to user ${assigneeId}`);

    if (!context.conversationId) {
  throw new Error("No conversationId provided in context");
}

    const conversation = await storage.updateConversation(context.conversationId, {assignedTo: assigneeId, status:"assigned"});
    
    if (!conversation) {
      throw new Error('Conversation not found for assignment');
    }
    console.log(`✅ Conversation assigned to: ${assigneeId}`);
    
    return {
      action: 'user_assigned',
      assigneeId,
      conversationId: context.conversationId
    };
  }

  private async executeAddToGroup(node: any, context: ExecutionContext) {
    const groupId = node.data?.groupId;
    if (!groupId) throw new Error('No group ID provided');
    if (!context.contactId) throw new Error('No contact ID in context');

    console.log(`👥 Adding contact ${context.contactId} to group ${groupId}`);

    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, context.contactId),
    });
    if (!contact) throw new Error('Contact not found');

    const group = await db.query.groups.findFirst({
      where: eq(groups.id, groupId),
    });
    const groupName = group?.name || groupId;

    const existingGroups: string[] = contact.groups || [];
    if (!existingGroups.includes(groupName)) {
      existingGroups.push(groupName);
      await db.update(contacts)
        .set({ groups: existingGroups })
        .where(eq(contacts.id, context.contactId));
    }

    return { action: 'added_to_group', groupId, groupName, contactId: context.contactId };
  }

  private async executeUpdateContact(node: any, context: ExecutionContext) {
    const field = node.data?.contactField;
    let value = node.data?.contactFieldValue || '';
    if (!field) throw new Error('No contact field specified');
    if (!context.contactId) throw new Error('No contact ID in context');

    value = this.replaceVariables(value, context.variables);

    console.log(`📝 Updating contact ${context.contactId} field "${field}" to "${value}"`);

    const updateData: Record<string, any> = {};
    if (field === 'name') updateData.name = value;
    else if (field === 'email') updateData.email = value;
    else if (field === 'notes') updateData.notes = value;
    else if (field === 'tags') {
      const tagList = value.split(',').map((t: string) => t.trim()).filter(Boolean);
      updateData.tags = tagList;
    }

    if (Object.keys(updateData).length > 0) {
      await db.update(contacts).set(updateData).where(eq(contacts.id, context.contactId));
    }

    return { action: 'contact_updated', field, value, contactId: context.contactId };
  }

  private async executeSetVariable(node: any, context: ExecutionContext) {
    const varName = node.data?.variableName;
    const source = node.data?.variableSource || 'static';
    let varValue = node.data?.variableValue || '';

    if (!varName) throw new Error('No variable name specified');

    console.log(`🔧 Setting variable "${varName}" (source: ${source})`);

    if (source === 'static') {
      varValue = this.replaceVariables(varValue, context.variables);
    } else if (source === 'from_message') {
      varValue = context.lastUserMessage || '';
    } else if (source === 'from_webhook') {
      const path = varValue;
      const webhookData = context.variables['_lastWebhookResponse'] || {};
      varValue = this.getNestedValue(webhookData, path) || '';
    }

    context.variables[varName] = varValue;

    return { action: 'variable_set', name: varName, value: varValue };
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((curr, key) => curr?.[key], obj);
  }

  private async executeSendLocation(node: any, context: ExecutionContext) {
    const { latitude, longitude, locationName, locationAddress } = node.data || {};
    if (!latitude || !longitude) throw new Error('Latitude and longitude are required');
    if (!context.conversationId) throw new Error('No conversation ID in context');

    console.log(`📍 Sending location: ${locationName || ''} (${latitude}, ${longitude})`);

    const conversation = await storage.getConversation(context.conversationId);
    if (!conversation) throw new Error('Conversation not found');

    const channel = await db.query.channels.findFirst({
      where: eq(channels.id, conversation.channelId || ''),
    });
    if (!channel) throw new Error('Channel not found');

    const payload = {
      messaging_product: "whatsapp",
      to: conversation.contactPhone,
      type: "location",
      location: {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        name: locationName || undefined,
        address: locationAddress || undefined,
      },
    };

    const response = await fetch(
      `https://graph.facebook.com/v24.0/${channel.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();
    if (!response.ok) throw new Error(`WhatsApp API error: ${JSON.stringify(result.error)}`);

    const locationText = `📍 ${locationName || 'Location'}: ${latitude}, ${longitude}`;
    await storage.createMessage({
      conversationId: context.conversationId,
      content: locationText,
      status: 'sent',
      messageType: 'location',
      whatsappMessageId: result?.messages?.[0]?.id,
    });

    return { action: 'location_sent', latitude, longitude, locationName };
  }

  private async executeSendListMessage(node: any, context: ExecutionContext) {
    const { message, listButtonText, listSections } = node.data || {};
    if (!message) throw new Error('List message body text is required');
    if (!listSections || listSections.length === 0) throw new Error('At least one section is required');
    if (!context.conversationId) throw new Error('No conversation ID in context');

    console.log(`📋 Sending list message with ${listSections.length} sections`);

    const conversation = await storage.getConversation(context.conversationId);
    if (!conversation) throw new Error('Conversation not found');

    const channel = await db.query.channels.findFirst({
      where: eq(channels.id, conversation.channelId || ''),
    });
    if (!channel) throw new Error('Channel not found');

    const bodyText = this.replaceVariables(message, context.variables);

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: conversation.contactPhone,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: listButtonText || "View Options",
          sections: listSections.map((section: any) => ({
            title: section.title,
            rows: section.rows.map((row: any) => ({
              id: row.id || `row_${Math.random().toString(36).slice(2, 8)}`,
              title: row.title,
              ...(row.description ? { description: row.description } : {}),
            })),
          })),
        },
      },
    };

    const response = await fetch(
      `https://graph.facebook.com/v24.0/${channel.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();
    if (!response.ok) throw new Error(`WhatsApp API error: ${JSON.stringify(result.error)}`);

    await storage.createMessage({
      conversationId: context.conversationId,
      content: bodyText,
      status: 'sent',
      messageType: 'interactive',
      whatsappMessageId: result?.messages?.[0]?.id,
      metadata: JSON.stringify({ listSections, interactiveType: "list" }),
    });

    const allRows = listSections.flatMap((s: any) => s.rows || []);
    const pendingId = `${context.executionId}_${node.nodeId}_${Date.now()}`;

    const pendingExecution: PendingExecution = {
      executionId: context.executionId,
      automationId: context.automationId,
      nodeId: node.nodeId,
      conversationId: context.conversationId,
      contactId: context.contactId,
      context: { ...context },
      saveAs: node.data.saveAs,
      timestamp: new Date(),
      status: 'waiting_for_response',
      expectedButtons: allRows.map((r: any) => ({ id: r.id, text: r.title })),
    };

    this.pendingExecutions.set(pendingId, pendingExecution);

    await db.update(automationExecutions)
      .set({
        status: 'paused',
        result: `Waiting for list selection: "${bodyText}"`,
      })
      .where(eq(automationExecutions.id, context.executionId));

    await this.logNodeExecution(
      context.executionId,
      node.nodeId,
      node.type,
      'waiting_for_response',
      { ...node.data, message: bodyText, listSections },
      { pendingId, action: 'list_message_sent_waiting' },
      null,
    );

    console.log(`📋 List message sent, pausing for user selection (pending ID: ${pendingId})`);

    return {
      action: 'execution_paused',
      message: bodyText,
      listSections,
      conversationId: context.conversationId,
      pendingId,
      saveAs: node.data.saveAs,
    };
  }

  private async executeSendMedia(node: any, context: ExecutionContext) {
    const { mediaType, mediaUrl, mediaId, mediaSourceType, mediaCaption } = node.data || {};
    const useUpload = mediaSourceType === "upload" || (!mediaSourceType && !!mediaId && !mediaUrl);
    const hasMedia = useUpload ? !!mediaId : !!mediaUrl;
    if (!mediaType || !hasMedia) throw new Error('Media type and media source (URL or uploaded file) are required');
    if (!context.conversationId) throw new Error('No conversation ID in context');

    console.log(`📎 Sending ${mediaType}: ${useUpload ? `mediaId:${mediaId}` : mediaUrl}`);

    const conversation = await storage.getConversation(context.conversationId);
    if (!conversation) throw new Error('Conversation not found');

    const channel = await db.query.channels.findFirst({
      where: eq(channels.id, conversation.channelId || ''),
    });
    if (!channel) throw new Error('Channel not found');

    const caption = mediaCaption ? this.replaceVariables(mediaCaption, context.variables) : undefined;

    const mediaPayload: any = useUpload
      ? { id: mediaId, ...(caption && mediaType !== 'audio' ? { caption } : {}) }
      : { link: mediaUrl, ...(caption && mediaType !== 'audio' ? { caption } : {}) };

    const payload: any = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: conversation.contactPhone,
      type: mediaType,
      [mediaType]: mediaPayload,
    };

    const response = await fetch(
      `https://graph.facebook.com/v24.0/${channel.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();
    if (!response.ok) throw new Error(`WhatsApp API error: ${JSON.stringify(result.error)}`);

    await storage.createMessage({
      conversationId: context.conversationId,
      content: caption || `[${mediaType}]`,
      status: 'sent',
      messageType: mediaType,
      whatsappMessageId: result?.messages?.[0]?.id,
    });

    return { action: 'media_sent', mediaType, mediaUrl };
  }

  private async executeMarkAsRead(node: any, context: ExecutionContext) {
    if (!context.conversationId) throw new Error('No conversation ID in context');

    console.log(`✅ Marking conversation ${context.conversationId} as read`);

    const conversation = await storage.getConversation(context.conversationId);
    if (!conversation) throw new Error('Conversation not found');

    const channel = await db.query.channels.findFirst({
      where: eq(channels.id, conversation.channelId || ''),
    });
    if (!channel) throw new Error('Channel not found');

    const lastMsgId = context.triggerData?.messageId;
    if (lastMsgId) {
      await fetch(
        `https://graph.facebook.com/v24.0/${channel.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${channel.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            status: "read",
            message_id: lastMsgId,
          }),
        }
      );
    }

    await storage.updateConversation(context.conversationId, { unreadCount: 0 });

    return { action: 'marked_as_read', conversationId: context.conversationId };
  }

  private async executeWebhook(node: any, context: ExecutionContext) {
    const url = this.replaceVariables(node.data?.webhookUrl || '', context.variables);
    const method = (node.data?.webhookMethod || 'POST').toUpperCase();
    const customHeaders = node.data?.webhookHeaders || {};
    const customBody = node.data?.webhookBody || '';

    if (!url) throw new Error('No webhook URL provided');

    console.log(`🌐 Executing webhook: ${method} ${url}`);

    const contact = context.contactId
      ? await db.query.contacts.findFirst({ where: eq(contacts.id, context.contactId) })
      : null;

    const conversation = context.conversationId
      ? await storage.getConversation(context.conversationId)
      : null;

    let channelData: any = null;
    if (conversation?.channelId) {
      channelData = await db.query.channels.findFirst({
        where: eq(channels.id, conversation.channelId),
      });
    }

    const automationPayload = {
      event: 'automation_webhook',
      timestamp: new Date().toISOString(),
      automation: {
        id: context.automationId,
        executionId: context.executionId,
        nodeId: node.nodeId,
      },
      contact: contact ? {
        id: contact.id,
        name: contact.name || '',
        phone: contact.phone || '',
        email: (contact as any).email || '',
        groups: contact.groups || [],
        tags: (contact as any).tags || [],
        source: contact.source || '',
        createdAt: contact.createdAt,
      } : null,
      conversation: conversation ? {
        id: conversation.id,
        status: conversation.status,
        lastMessageText: conversation.lastMessageText || '',
        unreadCount: conversation.unreadCount || 0,
      } : null,
      channel: channelData ? {
        id: channelData.id,
        name: channelData.name || '',
        phoneNumber: channelData.phoneNumber || '',
      } : null,
      lastUserMessage: context.lastUserMessage || '',
      variables: { ...context.variables },
    };

    delete automationPayload.variables['_lastWebhookResponse'];

    let body: string | undefined;
    const headers: Record<string, string> = {
      'User-Agent': 'WhatsApp-Marketing-Platform/1.0',
      ...customHeaders,
    };

    const templateVars = {
      ...context.variables,
      contact_name: contact?.name || '',
      contact_phone: contact?.phone || '',
      contact_email: (contact as any)?.email || '',
      contact_groups: JSON.stringify(contact?.groups || []),
      last_message: context.lastUserMessage || '',
      conversation_id: context.conversationId || '',
      channel_name: channelData?.name || '',
      channel_phone: channelData?.phoneNumber || '',
    };

    let finalUrl = url;

    if (method === 'POST' || method === 'PUT') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      if (customBody.trim()) {
        body = this.replaceVariables(customBody, templateVars);
      } else {
        body = JSON.stringify(automationPayload);
      }
    } else if (method === 'GET') {
      const flatParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(templateVars)) {
        if (k.startsWith('_')) continue;
        flatParams[k] = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
      }
      const queryParams = new URLSearchParams(flatParams);
      const separator = finalUrl.includes('?') ? '&' : '?';
      finalUrl = `${finalUrl}${separator}${queryParams.toString()}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const fetchOptions: any = { method, headers, signal: controller.signal };
      if (body && (method === 'POST' || method === 'PUT')) {
        fetchOptions.body = body;
      }

      const response = await fetch(finalUrl, fetchOptions);
      clearTimeout(timeout);

      const responseStatus = response.status;
      let responseData: any = null;
      const responseText = await response.text();

      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { text: responseText };
      }

      context.variables['_lastWebhookResponse'] = responseData;
      context.variables['_lastWebhookStatus'] = responseStatus;

      console.log(`✅ Webhook response: ${responseStatus} - ${responseText.substring(0, 200)}`);

      if (!response.ok) {
        console.warn(`⚠️ Webhook returned non-OK status: ${responseStatus}`);
      }

      return {
        action: 'webhook_executed',
        url: finalUrl,
        method,
        status: responseStatus,
        response: responseData,
      };
    } catch (error: any) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        console.error(`⏱️ Webhook timed out after 30s: ${finalUrl}`);
        context.variables['_lastWebhookResponse'] = { error: 'timeout' };
        context.variables['_lastWebhookStatus'] = 408;
        return {
          action: 'webhook_timeout',
          url: finalUrl,
          method,
          error: 'Request timed out after 30 seconds',
        };
      }
      throw error;
    }
  }

  private replaceVariables(text: string, variables: Record<string, any>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
      return variables[varName] !== undefined ? String(variables[varName]) : `{{${varName}}}`;
    });
  }

  getPendingExecutions() {
    return Array.from(this.pendingExecutions.entries()).map(([pendingId, execution]) => ({
      pendingId,
      executionId: execution.executionId,
      conversationId: execution.conversationId,
      nodeId: execution.nodeId,
      contactId: execution.contactId,
      saveAs: execution.saveAs,
      timestamp: execution.timestamp,
      waitingTime: Date.now() - execution.timestamp.getTime()
    }));
  }

  hasPendingExecution(conversationId: string): boolean {
    return this.findPendingExecutionByConversation(conversationId) !== null;
  }

  async cleanupExpiredExecutions(timeoutMs: number = 30 * 60 * 1000) { 
    const now = Date.now();
    const expired: { pendingId: string; execution: PendingExecution }[] = [];

    for (const [pendingId, execution] of this.pendingExecutions.entries()) {
      if (now - execution.timestamp.getTime() > timeoutMs) {
        expired.push({ pendingId, execution });
      }
    }
    
    for (const { pendingId, execution } of expired) {
      this.pendingExecutions.delete(pendingId);
      
      
      await this.completeExecution(
        execution.executionId,
        'failed',
        'Execution timed out waiting for user response'
      );
      
      console.warn(`⚠️  Cleaned up expired execution: ${pendingId} (conversation: ${execution.conversationId})`);
    }
    
    return expired.length;
  }

  async cancelExecution(conversationId: string): Promise<boolean> {
    const pending = this.findPendingExecutionByConversation(conversationId);
    if (pending) {
      this.pendingExecutions.delete(pending.pendingId);
      await this.completeExecution(pending.executionId, 'failed', 'Execution cancelled by user');
      console.log(`❌ Cancelled execution for conversation: ${conversationId}`);
      return true;
    }
    return false;
  }

  private async completeExecution(executionId: string, status: 'completed' | 'failed', result: string) {
    await db.update(automationExecutions)
      .set({
        status,
        completedAt: new Date(),
        result
      })
      .where(eq(automationExecutions.id, executionId));

    console.log(`🏁 Execution ${executionId} ${status}: ${result}`);
  }

  private async logNodeExecution(
    executionId: string,
    nodeId: string,
    nodeType: string,
    status: string,
    input: any,
    output: any,
    error: string | null
  ) {
    await db.insert(automationExecutionLogs).values({
      executionId,
      nodeId,
      nodeType,
      status,
      input: JSON.stringify(input),
      output: JSON.stringify(output),
      error
    });
  }

  private async getAutomationWithFlow(automationId: string) {
    
    const automation = await db.query.automations.findFirst({
      where: eq(automations.id, automationId),
      with: {
        nodes: true,
        edges: true,
      },
    });
  
    return automation;
  }
}

export class AutomationTriggerService {
  private executionService: AutomationExecutionService;

  constructor() {
    this.executionService = new AutomationExecutionService();
  }

  
  async handleNewConversation(conversationId: string, channelId: string, contactId?: string) {
    console.log(`🎯 New conversation trigger: ${conversationId}`);
    
    
    const activeAutomations = await db.select()
      .from(automations)
      .where(and(
        eq(automations.channelId, channelId),
        eq(automations.trigger, 'new_conversation'),
        eq(automations.status, 'active')
      ));

    console.log(`Found ${activeAutomations.length} active automation(s)`);

    
    for (const automation of activeAutomations) {
      try {
        
        const [execution] = await db.insert(automationExecutions).values({
          automationId: automation.id,
          contactId,
          conversationId,
          triggerData: {
            trigger: 'new_conversation',
            channelId,
            timestamp: new Date()
          },
          status: 'running'
        }).returning();

        
        await this.executionService.executeAutomation(execution.id);

      } catch (error) {
        console.error(`Failed to execute automation ${automation.id}:`, error);
      }
    }
  }

  
  
  
    
  
  
  
  
  
  
  
  
  
  
  
    
  
  
  
  
  
  
  
  

  
  
  
  
  
  
  
  
  
  
  
  
  
  

  
  
  
  
  
  

  async handleMessageReceived(conversationId: string, message: any, channelId: string, contactId?: string) {
    console.log(`💬 Message received trigger: ${conversationId}`);
    console.log(`🔍 Channel ID: ${channelId}, Contact ID: ${contactId}`);
    console.log(`📝 Message: "${message.content || message.text || message}"`);
    
    
    if (this.executionService.hasPendingExecution(conversationId)) {
      console.log(`📨 Processing as user response to pending execution`);
      try {
        await this.executionService.handleUserResponse(conversationId, message.content || message.text || message, message.interactive);
        return; 
      } catch (error) {
        console.error(`Error handling user response:`, error);
        
      }
    }
    
    
    const allAutomations = await db.select()
      .from(automations)
      .where(eq(automations.channelId, channelId));
      
    console.log(`📊 Total automations for channel ${channelId}: ${allAutomations.length}`);
    allAutomations.forEach(auto => {
      console.log(`   - ID: ${auto.id}, Name: "${auto.name}", Trigger: ${auto.trigger}, Status: ${auto.status}`);
    });
    
    
    const activeAutomations = await db.select()
      .from(automations)
      .where(and(
        eq(automations.channelId, channelId),
        eq(automations.status, 'active')
      ));
  
    console.log(`🎯 Found ${activeAutomations.length} active message_received automation(s)`);
    
    if (activeAutomations.length === 0) {
      console.warn(`⚠️ No active automations found for message_received trigger on channel ${channelId}`);
      return;
    }
  
    for (const automation of activeAutomations) {
      console.log(`🚀 Starting automation: ${automation.id} - "${automation.name}"`);
      
      try {
        
        const nodeCount = await db.select({ count: sql`count(*)` })
          .from(automationNodes)
          .where(eq(automationNodes.automationId, automation.id));
          
        console.log(`🔗 Automation ${automation.id} has ${nodeCount[0]?.count || 0} nodes`);
        
        if (!nodeCount[0]?.count || nodeCount[0].count === 0) {
          console.warn(`⚠️ Automation ${automation.id} has no nodes, skipping`);
          continue;
        }
        
        const [execution] = await db.insert(automationExecutions).values({
          automationId: automation.id,
          contactId,
          conversationId,
          triggerData: {
            trigger: 'message_received',
            message,
            channelId,
            timestamp: new Date()
          },
          status: 'running'
        }).returning();
  
        console.log(`✅ Created execution record: ${execution.id}`);
        
        await this.executionService.executeAutomation(execution.id);
        
        console.log(`🎉 Automation ${automation.id} execution completed`);
        
      } catch (error) {
        console.error(`❌ Failed to execute automation ${automation.id}:`, error);
        console.error(`Stack trace:`,  (error as Error).stack);
      }
    }
  }

  
  getExecutionService() {
    return this.executionService;
  }
}

export const executionService = new AutomationExecutionService();
export const triggerService = new AutomationTriggerService();

setInterval(() => {
  executionService.cleanupExpiredExecutions();
}, 5 * 60 * 1000);
