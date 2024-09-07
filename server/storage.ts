import { OURSAAS_BRAND } from "@oursaas/core";
import {
  type User,
  type InsertUser,
  type Contact,
  type InsertContact,
  type Campaign,
  type InsertCampaign,
  type Channel,
  type InsertChannel,
  type Template,
  type InsertTemplate,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
  type Automation,
  type InsertAutomation,
  type Analytics,
  type InsertAnalytics,
  type WhatsappChannel,
  type InsertWhatsappChannel,
  type WebhookConfig,
  type InsertWebhookConfig,
  type MessageQueue,
  type InsertMessageQueue,
  type ApiLog,
  type InsertApiLog,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;

  
  getContacts(): Promise<Contact[]>;
  getContactsByUser(userId: String): Promise<Contact[]>;
  getContactsByChannel(channelId: string): Promise<Contact[]>;
  getContact(id: string): Promise<Contact | undefined>;
  getContactByPhone(phone: string): Promise<Contact | undefined>;
  getContactByPhoneAndChannel(phone: string, channelId: string): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(id: string, contact: Partial<Contact>): Promise<Contact | undefined>;
  deleteContact(id: string): Promise<boolean>;
  searchContacts(query: string): Promise<Contact[]>;
  searchContactsByChannel(channelId: string, query: string): Promise<Contact[]>;

  
  getCampaigns(): Promise<Campaign[]>;
  getScheduledCampaigns(now: Date): Promise<Campaign[]>;
  getCampaignByUserId(userId: string): Promise<Campaign[]>;
  getCampaignsByChannel(channelId: string): Promise<Campaign[]>;
  getCampaign(id: string): Promise<Campaign | undefined>;
  createCampaign(campaign: InsertCampaign): Promise<Campaign>;
  updateCampaign(id: string, campaign: Partial<Campaign>): Promise<Campaign | undefined>;
  incrementCampaignSentCount(id: string): Promise<void>;
  incrementCampaignFailedCount(id: string): Promise<void>;
  deleteCampaign(id: string): Promise<boolean>;

  
  getTemplates(): Promise<Template[]>;
  getTemplatesByChannel(channelId: string): Promise<Template[]>;
  getTemplate(id: string): Promise<Template | undefined>;
  createTemplate(template: InsertTemplate): Promise<Template>;
  updateTemplate(id: string, template: Partial<Template>): Promise<Template | undefined>;
  deleteTemplate(id: string): Promise<boolean>;

  
  getConversations(): Promise<Conversation[]>;
  getConversationsByChannel(channelId: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | undefined>;
  getConversationByPhone(phone: string): Promise<Conversation | undefined>;
  getConversationByPhoneAndChannel(phone: string, channelId: string): Promise<Conversation | undefined>;
  createConversation(conversation: InsertConversation): Promise<Conversation>;
  updateConversation(id: string, conversation: Partial<Conversation>): Promise<Conversation | undefined>;
  deleteConversation(id: string): Promise<boolean>;

  
  getMessages(conversationId: string): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  updateMessage(id: string, message: Partial<Message>): Promise<Message | undefined>;
  getMessageByWhatsAppId(whatsappMessageId: string): Promise<Message | undefined>;

  
  getAutomations(): Promise<Automation[]>;
  getAutomationsByChannel(channelId: string): Promise<Automation[]>;
  getAutomation(id: string): Promise<Automation | undefined>;
  createAutomation(automation: InsertAutomation): Promise<Automation>;
  updateAutomation(id: string, automation: Partial<Automation>): Promise<Automation | undefined>;
  deleteAutomation(id: string): Promise<boolean>;

  
  getAnalytics(days?: number): Promise<Analytics[]>;
  getAnalyticsByChannel(channelId: string, days?: number): Promise<Analytics[]>;
  createAnalytics(analytics: InsertAnalytics): Promise<Analytics>;
  getDashboardStats(): Promise<{
    totalMessages: number;
    activeCampaigns: number;
    deliveryRate: number;
    newLeads: number;
    messagesGrowth: number;
    campaignsRunning: number;
    unreadChats: number;
  }>;
  getDashboardStatsByChannel(channelId: string): Promise<{
    totalMessages: number;
    activeCampaigns: number;
    deliveryRate: number;
    newLeads: number;
    messagesGrowth: number;
    campaignsRunning: number;
    unreadChats: number;
  }>;

  
  getChannels(): Promise<Channel[]>;
  getChannelsByUser(userId: string): Promise<Channel[]>;
  getChannel(id: string): Promise<Channel | undefined>;
  getChannelByPhoneNumberId(phoneNumberId: string): Promise<Channel | undefined>;
  getChannelsByPhoneNumber(phoneNumber: string): Promise<Channel[]>;
  createChannel(channel: InsertChannel): Promise<Channel>;
  updateChannel(id: string, channel: Partial<Channel>): Promise<Channel | undefined>;
  deleteChannel(id: string): Promise<boolean>;
  getActiveChannel(): Promise<Channel | undefined>;

  
  getWhatsappChannels(): Promise<WhatsappChannel[]>;
  getWhatsappChannel(id: string): Promise<WhatsappChannel | undefined>;
  createWhatsappChannel(channel: InsertWhatsappChannel): Promise<WhatsappChannel>;
  updateWhatsappChannel(id: string, channel: Partial<WhatsappChannel>): Promise<WhatsappChannel | undefined>;
  

  
  getWebhookConfigs(): Promise<WebhookConfig[]>;
  getWebhookConfig(id: string): Promise<WebhookConfig | undefined>;
  createWebhookConfig(config: InsertWebhookConfig): Promise<WebhookConfig>;
  updateWebhookConfig(id: string, config: Partial<WebhookConfig>): Promise<WebhookConfig | undefined>;
  deleteWebhookConfig(id: string): Promise<boolean>;

  
  getWebhookConfigs(): Promise<WebhookConfig[]>;
  getWebhookConfig(channelId: string): Promise<WebhookConfig | undefined>;
  createWebhookConfig(config: InsertWebhookConfig): Promise<WebhookConfig>;
  updateWebhookConfig(id: string, config: Partial<InsertWebhookConfig>): Promise<WebhookConfig | undefined>;
  deleteWebhookConfig(id: string): Promise<boolean>;

  
  getMessageQueueStats(): Promise<Record<string, number>>;
  getQueuedMessages(limit?: number): Promise<MessageQueue[]>;

  
  getApiLogs(channelId?: string, limit?: number): Promise<ApiLog[]>;
  logApiRequest(log: InsertApiLog): Promise<ApiLog | null>;

  getWhatsappChannels(): Promise<WhatsappChannel[]>;
  deleteWhatsappChannel(id: string): Promise<void>;
  getMessageQueue(): Promise<MessageQueue>;
  

  getCampaignsByChannel(channelId: string): Promise<Campaign[]>;
getTemplatesByChannel(channelId: string): Promise<Template[]>;
getTemplatesByUserId(userId: string): Promise<Template[]>;
getTemplatesByChannelAndUser(channelId: string, userId: string): Promise<Template[]>;
getConversationsByChannel(channelId: string): Promise<Conversation[]>;
deleteConversation(id: string): Promise<boolean>;
getAutomationByChannel(channelId: string): Promise<Automation[]>;
getAnalyticsByChannel(channelId: string, days?: number): Promise<Analytics[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private contacts: Map<string, Contact> = new Map();
  private campaigns: Map<string, Campaign> = new Map();
  private channels: Map<string, Channel> = new Map();
  private templates: Map<string, Template> = new Map();
  private conversations: Map<string, Conversation> = new Map();
  private messages: Map<string, Message> = new Map();
  private automations: Map<string, Automation> = new Map();
  private analytics: Map<string, Analytics> = new Map();
  private whatsappChannels: Map<string, WhatsappChannel> = new Map();
  private webhookConfigs: Map<string, WebhookConfig> = new Map();
  private messageQueues: Map<string, MessageQueue> = new Map();
  private apiLogs: Map<string, ApiLog> = new Map();

  constructor() {
    this.initializeSampleData();
  }

  private initializeSampleData() {
    
    const today = new Date();
    const analyticsEntry: Analytics = {
      id: randomUUID(),
      channelId: "default-channel",
      date: today,
      messagesSent: 0,
      messagesDelivered: 0,
      messagesRead: 0,
      messagesReplied: 0,
      newContacts: 0,
      activeCampaigns: 0,
      createdAt: today,
    };
    this.analytics.set(analyticsEntry.id, analyticsEntry);

    
      const defaultChannel: Channel = {
        id: randomUUID(),
        name: "Main WhatsApp Channel",
        phoneNumberId: "153851404474202", 
        accessToken: "Bearer EAAxxxxxxx", 
        whatsappBusinessAccountId: "123456789012345", 
        phoneNumber: "+1234567890", 
        isActive: true,
        healthStatus: "unknown",     
        lastHealthCheck: null,       
        healthDetails: null,         
        createdAt: today,
        updatedAt: today,
      };
      this.channels.set(defaultChannel.id, defaultChannel);

  }

  
async getDashboardStatsByChannel(channelId: string) {
  const campaigns = Array.from(this.campaigns.values()).filter(c => c.channelId === channelId);
  const contacts = Array.from(this.contacts.values()).filter(c => c.channelId === channelId);
  const conversations = Array.from(this.conversations.values()).filter(c => c.channelId === channelId);

  const activeCampaigns = campaigns.filter(c => c.status === 'active').length;
  const totalSent = campaigns.reduce((sum, c) => sum + (c.sentCount || 0), 0);
  const totalDelivered = campaigns.reduce((sum, c) => sum + (c.deliveredCount || 0), 0);
  const deliveryRate = totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const newLeads = contacts.filter(c => c.createdAt && c.createdAt >= weekAgo).length;

  const unreadChats = conversations.filter(c => c.status === 'open').length;

  return {
    totalMessages: totalSent,
    activeCampaigns,
    deliveryRate: Math.round(deliveryRate * 10) / 10,
    newLeads,
    messagesGrowth: 12.5,
    campaignsRunning: activeCampaigns,
    unreadChats,
  };
}

async getChannelByPhoneNumberId(phoneNumberId: string): Promise<Channel | undefined> {
  return Array.from(this.channels.values()).find(c => c.phoneNumberId === phoneNumberId);
}

async getChannelsByPhoneNumber(phoneNumber: string): Promise<Channel[]> {
  return Array.from(this.channels.values()).filter(c => c.phoneNumber === phoneNumber);
}

async getMessageQueue(): Promise<MessageQueue> {
  return {} as MessageQueue;
}

 async getAutomationByChannel(channelId: string): Promise<{ id: string; name: string; createdAt: Date | null; updatedAt: Date | null; channelId: string | null; description: string | null; trigger: string; triggerConfig: unknown; status: string | null; executionCount: number | null; lastExecutedAt: Date | null; createdBy: string | null; }[]> {
    return Array.from(this.automations.values()).filter(a => a.channelId === channelId);
}

  async getCampaignsByChannel(channelId: string): Promise<Campaign[]> {
    return Array.from(this.campaigns.values()).filter(c => c.channelId === channelId);
  }
  
  async getTemplatesByChannel(channelId: string): Promise<Template[]> {
    return Array.from(this.templates.values()).filter(t => t.channelId === channelId);
  }
  
  async getConversationsByChannel(channelId: string): Promise<Conversation[]> {
    return Array.from(this.conversations.values()).filter(c => c.channelId === channelId);
  }
  
  async deleteConversation(id: string): Promise<boolean> {
    return this.conversations.delete(id);
  }
  
  async getAutomationsByChannel(channelId: string): Promise<Automation[]> {
    return Array.from(this.automations.values()).filter(a => a.channelId === channelId);
  }
  
  async getAnalyticsByChannel(channelId: string, days: number = 30): Promise<Analytics[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return Array.from(this.analytics.values())
      .filter(a => a.channelId === channelId && a.date >= cutoff);
  }
  

  
async getAllUsers(): Promise<User[]> {
  return Array.from(this.users.values());
}

async getContactsByChannel(channelId: string): Promise<Contact[]> {
  return Array.from(this.contacts.values()).filter(c => c.channelId === channelId);
}

async getContactByPhone(phone: string): Promise<Contact | undefined> {
  return Array.from(this.contacts.values()).find(c => c.phone === phone);
}

async getContactByPhoneAndChannel(phone: string, channelId: string): Promise<Contact | undefined> {
  return Array.from(this.contacts.values()).find(c => c.phone === phone && c.channelId === channelId);
}

async searchContactsByChannel(channelId: string, query: string): Promise<Contact[]> {
  const lowerQuery = query.toLowerCase();
  return Array.from(this.contacts.values())
    .filter(c => c.channelId === channelId)
    .filter(c => c.name.toLowerCase().includes(lowerQuery) || c.phone.includes(query));
}

  
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = {
      ...insertUser,
      id,
      firstName: insertUser.firstName || null,
      lastName: insertUser.lastName || null,
      avatar: insertUser.avatar || null,
      role: insertUser.role || "agent",
      status: insertUser.status || "active",
      lastLogin: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  
  async getContacts(): Promise<Contact[]> {
    return Array.from(this.contacts.values()).sort((a, b) => 
      (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

  async getContactsByUser(userId: string): Promise<Contact[]> {
  return Array.from(this.contacts.values())
    .filter(c => c.createdBy === userId) 
    .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
}

  

  async getContact(id: string): Promise<Contact | undefined> {
    return this.contacts.get(id);
  }

  async createContact(insertContact: InsertContact): Promise<Contact> {
    const id = randomUUID();
    const contact: Contact = {
      ...insertContact,
      id,
      channelId: insertContact.channelId || null,
      email: insertContact.email || null,
      groups: Array.isArray(insertContact.groups)? (insertContact.groups as string[]): [],
      tags: insertContact.tags || [],
      status: insertContact.status || "active",
      lastContact: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    };
    this.contacts.set(id, contact);
    return contact;
  }

  async updateContact(id: string, updates: Partial<Contact>): Promise<Contact | undefined> {
    const contact = this.contacts.get(id);
    if (!contact) return undefined;

    const updatedContact = { ...contact, ...updates };
    this.contacts.set(id, updatedContact);
    return updatedContact;
  }

  async deleteContact(id: string): Promise<boolean> {
    return this.contacts.delete(id);
  }

  async searchContacts(query: string): Promise<Contact[]> {
    const lowercaseQuery = query.toLowerCase();
    return Array.from(this.contacts.values()).filter(contact =>
      contact.name.toLowerCase().includes(lowercaseQuery) ||
      contact.phone.includes(query) ||
      contact.email?.toLowerCase().includes(lowercaseQuery)
    );
  }

  
  async getCampaigns(): Promise<Campaign[]> {
    return Array.from(this.campaigns.values()).sort((a, b) => 
      (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

  async getScheduledCampaigns(now: Date): Promise<Campaign[]> {
  return Array.from(this.campaigns.values())
    .filter((campaign) => {
      return (
        campaign.status === "scheduled" &&
        campaign.scheduledAt &&
        campaign.scheduledAt <= now
      );
    })
    .sort(
      (a, b) =>
        (a.scheduledAt?.getTime() || 0) -
        (b.scheduledAt?.getTime() || 0)
    );
}

  async getCampaign(id: string): Promise<Campaign | undefined> {
    return this.campaigns.get(id);
  }

  async getCampaignByUserId(userId: string): Promise<Campaign[]> {
    return this.campaigns.get(userId);
  }

  async createCampaign(insertCampaign: InsertCampaign): Promise<Campaign> {
    const id = randomUUID();
    const campaign: Campaign = {
      ...insertCampaign,
      id,
      channelId: insertCampaign.channelId || null,
      status: insertCampaign.status || "draft",
      templateId: insertCampaign.templateId || null,
      templateLanguage: insertCampaign.templateLanguage || "en_US",
      templateName: insertCampaign.templateName || null,
      description: insertCampaign.description || null,
      apiKey: insertCampaign.apiKey || null,
      apiEndpoint: insertCampaign.apiEndpoint || null,
      variableMapping: insertCampaign.variableMapping || {},
      contactGroups: Array.isArray(insertCampaign.contactGroups)? (insertCampaign.contactGroups as string[]): [],
      csvData: insertCampaign.csvData || [],
      scheduledAt: insertCampaign.scheduledAt || null,
      recipientCount: insertCampaign.recipientCount || 0,
      sentCount: insertCampaign.sentCount || 0,
      readCount: insertCampaign.readCount || 0,
      repliedCount: insertCampaign.repliedCount || 0,
      failedCount: insertCampaign.failedCount || 0,
      deliveredCount: insertCampaign.deliveredCount || 0,
      completedAt: insertCampaign.completedAt || null,
      updatedAt: new Date(),
      createdAt: new Date(),
    };
    this.campaigns.set(id, campaign);
    return campaign;
  }

  async updateCampaign(id: string, updates: Partial<Campaign>): Promise<Campaign | undefined> {
    const campaign = this.campaigns.get(id);
    if (!campaign) return undefined;

    const updatedCampaign = { ...campaign, ...updates };
    this.campaigns.set(id, updatedCampaign);
    return updatedCampaign;
  }

  async incrementCampaignSentCount(id: string): Promise<void> {
    const campaign = this.campaigns.get(id);
    if (campaign) {
      campaign.sentCount = (campaign.sentCount || 0) + 1;
      this.campaigns.set(id, campaign);
    }
  }

  async incrementCampaignFailedCount(id: string): Promise<void> {
    const campaign = this.campaigns.get(id);
    if (campaign) {
      campaign.failedCount = (campaign.failedCount || 0) + 1;
      this.campaigns.set(id, campaign);
    }
  }

  async deleteCampaign(id: string): Promise<boolean> {
    return this.campaigns.delete(id);
  }

  
  async getChannels(): Promise<Channel[]> {
    return Array.from(this.channels.values()).sort((a, b) => 
      (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

 async getChannelsByUser(userId: string): Promise<Channel[]> {
    return Array.from(this.channels.values())
      .filter(channel => channel.createdBy === userId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getChannel(id: string): Promise<Channel | undefined> {
    return this.channels.get(id);
  }

  async createChannel(insertChannel: InsertChannel): Promise<Channel> {
    const id = randomUUID();
    const channel: Channel = {
      ...insertChannel,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      whatsappBusinessAccountId: insertChannel.whatsappBusinessAccountId || null,
      phoneNumber: insertChannel.phoneNumber || null,
      isActive: insertChannel.isActive ?? false,
      healthStatus: insertChannel.healthStatus || "unknown",
      lastHealthCheck: null,
      healthDetails: null,
    };
    this.channels.set(id, channel);
    return channel;
  }

  async updateChannel(id: string, updates: Partial<Channel>): Promise<Channel | undefined> {
    const channel = this.channels.get(id);
    if (!channel) return undefined;

    const updatedChannel = { ...channel, ...updates, updatedAt: new Date() };
    this.channels.set(id, updatedChannel);
    return updatedChannel;
  }

  async deleteChannel(id: string): Promise<boolean> {
    return this.channels.delete(id);
  }

  async getActiveChannel(): Promise<Channel | undefined> {
    const channels = Array.from(this.channels.values());
    return channels.find(c => c.isActive) || channels[0];
  }

  
  async getTemplates(): Promise<Template[]> {
    return Array.from(this.templates.values()).sort((a, b) => 
      (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

  async getTemplate(id: string): Promise<Template | undefined> {
    return this.templates.get(id);
  }

  async getTemplateByUserId(userId: string): Promise<Template | undefined>{
    return  this.templates.get(userId)
  }

  async getTemplatesByChannelAndUser(channelId: string, userId: string): Promise<Template[]> {
  const channel = this.channels.get(channelId);
  if (!channel) return [];
  
  if (channel.createdBy !== userId) return [];

  return Array.from(this.templates.values())
    .filter(t => t.channelId === channelId)
    .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
}

  async createTemplate(insertTemplate: InsertTemplate): Promise<Template> {
    const id = randomUUID();
    const template: Template = {
      ...insertTemplate,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: insertTemplate.status || "draft",
      channelId: insertTemplate.channelId || null,
      language: insertTemplate.language || "en_US",
      header: insertTemplate.header || null,
      footer: insertTemplate.footer || null,
      buttons: insertTemplate.buttons || [],
      variables: insertTemplate.variables || [],
      rejectionReason: insertTemplate.rejectionReason || null,
      whatsappTemplateId: insertTemplate.whatsappTemplateId || null,
      mediaType: insertTemplate.mediaType || "text",
      mediaUrl: insertTemplate.mediaUrl || null,
      mediaHandle: insertTemplate.mediaHandle || null,
      carouselCards: insertTemplate.carouselCards || [],
      usage_count: insertTemplate.usage_count ?? 0,
    };
    this.templates.set(id, template);
    return template;
  }

  async updateTemplate(id: string, updates: Partial<Template>): Promise<Template | undefined> {
    const template = this.templates.get(id);
    if (!template) return undefined;

    const updatedTemplate = { ...template, ...updates };
    this.templates.set(id, updatedTemplate);
    return updatedTemplate;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return this.templates.delete(id);
  }

  
  async getConversations(): Promise<Conversation[]> {
    return Array.from(this.conversations.values()).sort((a, b) => 
      (b.lastMessageAt?.getTime() || b.createdAt?.getTime() || 0) - 
      (a.lastMessageAt?.getTime() || a.createdAt?.getTime() || 0)
    );
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    return this.conversations.get(id);
  }

  async getConversationByPhone(phone: string): Promise<Conversation | undefined> {
    return Array.from(this.conversations.values()).find(c => c.contactPhone === phone);
  }

  async getConversationByPhoneAndChannel(phone: string, channelId: string): Promise<Conversation | undefined> {
    return Array.from(this.conversations.values()).find(c => c.contactPhone === phone && c.channelId === channelId);
  }

  async createConversation(insertConversation: InsertConversation): Promise<Conversation> {
    const id = randomUUID();
    const conversation: Conversation = {
      ...insertConversation,
      id,
      channelId: insertConversation.channelId || null,
      contactId: insertConversation.contactId || null,
      contactPhone: insertConversation.contactPhone || null,
      contactName: insertConversation.contactName || null,
      assignedTo: insertConversation.assignedTo || null,
      tags: insertConversation.tags || [],
      unreadCount: 0,
      priority: insertConversation.priority || "normal",
      status: insertConversation.status || "open",
      lastMessageAt: insertConversation.lastMessageAt || null,
      lastMessageText: insertConversation.lastMessageText || null,
      updatedAt: new Date(),
      createdAt: new Date(),
    };
    this.conversations.set(id, conversation);
    return conversation;
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation | undefined> {
    const conversation = this.conversations.get(id);
    if (!conversation) return undefined;

    const updatedConversation = { ...conversation, ...updates };
    this.conversations.set(id, updatedConversation);
    return updatedConversation;
  }

  
  async getMessages(conversationId: string): Promise<Message[]> {
    return Array.from(this.messages.values())
      .filter(message => message.conversationId === conversationId)
      .sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const id = randomUUID();
    const message: Message = {
      ...insertMessage,
      id,
      conversationId: insertMessage.conversationId || null,
      fromUser: insertMessage.fromUser || false,
      direction: insertMessage.direction || "inbound",
      messageType: insertMessage.messageType || "text",
      whatsappMessageId: insertMessage.whatsappMessageId || null,
      mediaUrl: insertMessage.mediaUrl || null,
      mediaId: insertMessage.mediaId || null,
      mediaMimeType: insertMessage.mediaMimeType || null,
      mediaSha256: insertMessage.mediaSha256 || null,
      metadata: insertMessage.metadata || {},
      type: insertMessage.type || "text",
      status: insertMessage.status || "sent",
      deliveredAt: insertMessage.deliveredAt || null,
      readAt: insertMessage.readAt || null,
      errorCode: insertMessage.errorCode || null,
      errorMessage: insertMessage.errorMessage || null,
      errorDetails: insertMessage.errorDetails || null,
      campaignId: insertMessage.campaignId || null,
      timestamp: insertMessage.timestamp || new Date(),
      updatedAt: new Date(),
      createdAt: new Date(),
    };
    this.messages.set(id, message);

    
    if (insertMessage.conversationId) {
      const conversation = this.conversations.get(insertMessage.conversationId);
      if (conversation) {
        this.conversations.set(conversation.id, {
          ...conversation,
          lastMessageAt: new Date(),
        });
      }
    }    

    return message;
  }

  async updateMessage(id: string, updates: Partial<Message>): Promise<Message | undefined> {
    const message = this.messages.get(id);
    if (!message) return undefined;

    const updatedMessage = { ...message, ...updates };
    this.messages.set(id, updatedMessage);
    return updatedMessage;
  }

  async getMessageByWhatsAppId(whatsappMessageId: string): Promise<Message | undefined> {
    return Array.from(this.messages.values()).find(m => m.whatsappMessageId === whatsappMessageId);
  }

  
  async getAutomations(): Promise<Automation[]> {
    return Array.from(this.automations.values()).sort((a, b) => 
      (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

  async getAutomation(id: string): Promise<Automation | undefined> {
    return this.automations.get(id);
  }

  async createAutomation(insertAutomation: InsertAutomation): Promise<Automation> {
    const id = randomUUID();
    const automation: Automation = {
      ...insertAutomation,
      id,
      channelId: insertAutomation.channelId || null,
      description: insertAutomation.description || null,
      triggerConfig: insertAutomation.triggerConfig || {},
      executionCount: 0,
      lastExecutedAt: null,
      status: insertAutomation.status || "inactive",
      createdBy: insertAutomation.createdBy || null,
      updatedAt: new Date(),
      createdAt: new Date(),
    };
    this.automations.set(id, automation);
    return automation;
  }

  async updateAutomation(id: string, updates: Partial<Automation>): Promise<Automation | undefined> {
    const automation = this.automations.get(id);
    if (!automation) return undefined;

    const updatedAutomation = { ...automation, ...updates };
    this.automations.set(id, updatedAutomation);
    return updatedAutomation;
  }

  async deleteAutomation(id: string): Promise<boolean> {
    return this.automations.delete(id);
  }

  
  async getAnalytics(days: number = 30): Promise<Analytics[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    return Array.from(this.analytics.values())
      .filter(analytics => analytics.date >= cutoffDate)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  async createAnalytics(insertAnalytics: InsertAnalytics): Promise<Analytics> {
    const id = randomUUID();
    const analytics: Analytics = {
      ...insertAnalytics,
      id,
      channelId: insertAnalytics.channelId || null,
      activeCampaigns: insertAnalytics.activeCampaigns || 0,
      newContacts: insertAnalytics.newContacts || 0,
      messagesDelivered: insertAnalytics.messagesDelivered || 0,
      messagesRead: insertAnalytics.messagesRead || 0,
      messagesSent: insertAnalytics.messagesSent || 0,
      messagesReplied: insertAnalytics.messagesReplied || 0,
      createdAt: new Date(),
    };
    this.analytics.set(id, analytics);
    return analytics;
  }

  async getDashboardStats(): Promise<{
    totalMessages: number;
    activeCampaigns: number;
    deliveryRate: number;
    newLeads: number;
    messagesGrowth: number;
    campaignsRunning: number;
    unreadChats: number;
  }> {
    const campaigns = await this.getCampaigns();
    const contacts = await this.getContacts();
    const conversations = await this.getConversations();
    
    const activeCampaigns = campaigns.filter(c => c.status === 'active').length;
    const totalSent = campaigns.reduce((sum, c) => sum + (c.sentCount || 0), 0);
    const totalDelivered = campaigns.reduce((sum, c) => sum + (c.deliveredCount || 0), 0);
    const deliveryRate = totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0;
    
    
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const newLeads = contacts.filter(c => c.createdAt && c.createdAt >= weekAgo).length;
    
    const unreadChats = conversations.filter(c => c.status === 'open').length;

    return {
      totalMessages: totalSent,
      activeCampaigns,
      deliveryRate: Math.round(deliveryRate * 10) / 10,
      newLeads,
      messagesGrowth: 12.5, 
      campaignsRunning: activeCampaigns,
      unreadChats,
    };
  }

  
  async getWhatsappChannels(): Promise<WhatsappChannel[]> {
    return Array.from(this.whatsappChannels.values());
  }

  async getWhatsappChannel(id: string): Promise<WhatsappChannel | undefined> {
    return this.whatsappChannels.get(id);
  }

  async createWhatsappChannel(insertChannel: InsertWhatsappChannel): Promise<WhatsappChannel> {
    const id = randomUUID();
    const channel: WhatsappChannel = {
      ...insertChannel,
      id,
      qualityRating: insertChannel.qualityRating || "green",
      businessAccountId: insertChannel.businessAccountId || null,
      rateLimitTier: insertChannel.rateLimitTier || "standard",
      lastHealthCheck: null,
      messageLimit: insertChannel.messageLimit || 0,
      messagesUsed: 0,
      errorMessage: null,
      status: insertChannel.status || "inactive",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.whatsappChannels.set(id, channel);
    return channel;
  }

  async updateWhatsappChannel(id: string, updates: Partial<WhatsappChannel>): Promise<WhatsappChannel | undefined> {
    const channel = this.whatsappChannels.get(id);
    if (channel) {
      const updated = { ...channel, ...updates, updatedAt: new Date() };
      this.whatsappChannels.set(id, updated);
      return updated;
    }
    return undefined;
  }

  async deleteWhatsappChannel(id: string): Promise<void> {
    this.whatsappChannels.delete(id);
    return;
  }
  

  
  async getWebhookConfigs(): Promise<WebhookConfig[]> {
    return Array.from(this.webhookConfigs.values());
  }

  async getWebhookConfig(channelId: string): Promise<WebhookConfig | undefined> {
    return Array.from(this.webhookConfigs.values()).find(config => config.channelId === channelId);
  }

  async createWebhookConfig(insertConfig: InsertWebhookConfig): Promise<WebhookConfig> {
    const id = randomUUID();
    const config: WebhookConfig = {
      ...insertConfig,
      id,
      events: insertConfig.events || [],
      lastPingAt: null,
      appSecret: insertConfig.appSecret || null,
      channelId: insertConfig.channelId || null,
      isActive: insertConfig.isActive ?? true,
      createdAt: new Date(),
    };
    this.webhookConfigs.set(id, config);
    return config;
  }

  async updateWebhookConfig(id: string, updates: Partial<InsertWebhookConfig>): Promise<WebhookConfig | undefined> {
    const config = this.webhookConfigs.get(id);
    if (config) {
      const updated = { ...config, ...updates };
      this.webhookConfigs.set(id, updated);
      return updated;
    }
    return undefined;
  }

  async deleteWebhookConfig(id: string): Promise<boolean> {
    return this.webhookConfigs.delete(id);
  }

  
  async getMessageQueueStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {
      queued: 0,
      processing: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
    };
    
    this.messageQueues.forEach(message => {
      if (message.status) {
        stats[message.status] = (stats[message.status] || 0) + 1;
      }
    });
    
    return stats;
  }

  async getQueuedMessages(limit: number = 10): Promise<MessageQueue[]> {
    return Array.from(this.messageQueues.values())
      .filter(msg => msg.status === 'queued')
      .slice(0, limit);
  }

  
  async getApiLogs(channelId?: string, limit: number = 100): Promise<ApiLog[]> {
    let logs = Array.from(this.apiLogs.values());
    
    if (channelId) {
      logs = logs.filter(log => log.channelId === channelId);
    }
    
    return logs.slice(-limit);
  }

  async logApiRequest(log: InsertApiLog): Promise<ApiLog | null> {
    try {
      const apiLog: ApiLog = {
        ...log,
        id: Date.now().toString(),
        channelId: log.channelId || null,
        responseStatus: log.responseStatus || 0,
        requestBody: log.requestBody || null,
        responseBody: log.responseBody || null,
        duration: log.duration || 0,
        createdAt: new Date(),
      };
      
      if (log.channelId && !this.whatsappChannels.has(log.channelId)) {
        console.error("Channel not found for API log:", log.channelId);
        return null;
      }
      this.apiLogs.set(apiLog.id, apiLog);
      return apiLog;
    } catch (error) {
      console.error("Failed to log API request:", error);
      return null;
    }
  }
}

import { DatabaseStorage } from "./database-storage";
export const storage = new DatabaseStorage();
