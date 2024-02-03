import { Request, Response } from 'express';
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { chatbots, trainingData, conversations, messages } from '@shared/schema';
import { v4 as uuidv4 } from 'uuid';

export const createChatbot = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    
    const [newChatbot] = await db.insert(chatbots).values({
      uuid: uuidv4(),
      title: data.title,
      bubbleMessage: data.bubbleMessage,
      welcomeMessage: data.welcomeMessage,
      instructions: data.instructions,
      connectMessage: data.connectMessage,
      language: data.language || 'en',
      interactionType: data.interactionType || 'ai-only',
      avatarId: data.avatarId,
      avatarEmoji: data.avatarEmoji,
      avatarColor: data.avatarColor,
      primaryColor: data.primaryColor || '#3B82F6',
      logoUrl: data.logoUrl,
      embedWidth: data.embedWidth || 420,
      embedHeight: data.embedHeight || 745,
    }).returning();

    res.status(201).json({
      success: true,
      data: newChatbot,
    });
  } catch (error : any) {
    console.error('Create chatbot error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create chatbot',
      error: error.message,
    });
  }
};

export const getChatbot = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const [chatbot] = await db
      .select()
      .from(chatbots)
      .where(eq(chatbots.id, parseInt(id)));

    if (!chatbot) {
      return res.status(404).json({
        success: false,
        message: 'Chatbot not found',
      });
    }

    res.json({
      success: true,
      data: chatbot,
    });
  } catch (error : any) {
    console.error('Get chatbot error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chatbot',
      error: error.message,
    });
  }
};

export const getChatbotByUuid = async (req: Request, res: Response) => {
  try {
    const { uuid } = req.params;
    
    const [chatbot] = await db
      .select()
      .from(chatbots)
      .where(eq(chatbots.uuid, uuid));

    if (!chatbot) {
      return res.status(404).json({
        success: false,
        message: 'Chatbot not found',
      });
    }

    res.json({
      success: true,
      data: chatbot,
    });
  } catch (error : any) {
    console.error('Get chatbot by UUID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chatbot',
      error: error.message,
    });
  }
};

export const updateChatbot = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const [updatedChatbot] = await db
      .update(chatbots)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(chatbots.id, parseInt(id)))
      .returning();

    if (!updatedChatbot) {
      return res.status(404).json({
        success: false,
        message: 'Chatbot not found',
      });
    }

    res.json({
      success: true,
      data: updatedChatbot,
    });
  } catch (error : any) {
    console.error('Update chatbot error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update chatbot',
      error: error.message,
    });
  }
};

export const deleteChatbot = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await db.delete(chatbots).where(eq(chatbots.id, parseInt(id)));

    res.json({
      success: true,
      message: 'Chatbot deleted successfully',
    });
  } catch (error : any) {
    console.error('Delete chatbot error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete chatbot',
      error: error.message,
    });
  }
};

export const getAllChatbots = async (req: Request, res: Response) => {
  try {
    const allChatbots = await db.select().from(chatbots);

    res.json({
      success: true,
      data: allChatbots,
    });
  } catch (error : any) {
    console.error('Get all chatbots error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chatbots',
      error: error.message,
    });
  }
};

export const addTrainingData = async (req: Request, res: Response) => {
  try {
    const data = req.body;

    const [newTrainingData] = await db.insert(trainingData).values({
      chatbotId: data.chatbotId,
      type: data.type,
      title: data.title,
      content: data.content,
      metadata: data.metadata,
    }).returning();

    res.status(201).json({
      success: true,
      data: newTrainingData,
    });
  } catch (error : any) {
    console.error('Add training data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add training data',
      error: error.message,
    });
  }
};

export const getTrainingData = async (req: Request, res: Response) => {
  try {
    const { chatbotId } = req.params;

    const data = await db
      .select()
      .from(trainingData)
      .where(eq(trainingData.chatbotId, parseInt(chatbotId)));

    res.json({
      success: true,
      data,
    });
  } catch (error : any) {
    console.error('Get training data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get training data',
      error: error.message,
    });
  }
};

export const deleteTrainingData = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await db.delete(trainingData).where(eq(trainingData.id, parseInt(id)));

    res.json({
      success: true,
      message: 'Training data deleted successfully',
    });
  } catch (error : any) {
    console.error('Delete training data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete training data',
      error: error.message,
    });
  }
};

export const createConversation = async (req: Request, res: Response) => {
  try {
    const { chatbotId, sessionId } = req.body;

    const [newConversation] = await db.insert(conversations).values({
      chatbotId,
      sessionId,
    }).returning();

    res.status(201).json({
      success: true,
      data: newConversation,
    });
  } catch (error : any) {
    console.error('Create conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create conversation',
      error: error.message,
    });
  }
};

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { conversationId, type, content } = req.body;

    const [newMessage] = await db.insert(messages).values({
      conversationId,
      type,
      content,
    }).returning();

    
    
    let botResponse = null;
    if (type === 'user') {
      botResponse = await db.insert(messages).values({
        conversationId,
        type: 'bot',
        content: 'Thank you for your message. How can I assist you further?',
      }).returning();
    }

    res.status(201).json({
      success: true,
      data: {
        userMessage: newMessage,
        botMessage: botResponse ? botResponse[0] : null,
      },
    });
  } catch (error : any) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message,
    });
  }
};

export const getConversationMessages = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;

    const conversationMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, parseInt(conversationId)));

    res.json({
      success: true,
      data: conversationMessages,
    });
  } catch (error : any) {
    console.error('Get conversation messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      error: error.message,
    });
  }
};
