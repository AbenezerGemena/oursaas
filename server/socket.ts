import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { storage } from './storage';
import { getConversationsFromDB } from './services/conversation.service';
import { fetchConversationList } from './controllers/conversations.controller';

interface SocketUser {
  socketId: string;
  userId?: string;
  conversationId?: string;
  sessionId?: string;
  siteId?: string;
  role: 'visitor' | 'agent' | 'admin';
  name?: string;
}

const connectedUsers = new Map<string, SocketUser>();
const conversationRooms = new Map<string, Set<string>>(); 

export function initializeSocket(httpServer: HTTPServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*", 
      methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
  });

  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    const { sessionId, siteId, conversationId, userId, role } = socket.handshake.query;

    
    const user: SocketUser = {
      socketId: socket.id,
      userId: userId as string,
      conversationId: conversationId as string,
      sessionId: sessionId as string,
      siteId: siteId as string,
      role: (role as 'visitor' | 'agent' | 'admin') || 'visitor'
    };

    connectedUsers.set(socket.id, user);

    if (userId) {
      socket.join(`user:${userId}`);
    }

     socket.on("test_event", (data) => {
    console.log("🔥 TEST EVENT RECEIVED:", data);

    socket.emit("test_response", { msg: "Server se response aaya!" });
  });

     
  
  
  socket.on("get_conversations", async ({ channelId }) => {
    try {
      console.log("🔥 get_conversations called for channel:", channelId);

      const list = await fetchConversationList(channelId);

      console.log("🔥 conversations_list sending:", list?.length || 0);

      socket.emit("conversations_list", list);

    } catch (err) {
      console.error("Error fetching conversations via socket:", err);
    }
  });

    
    if (conversationId) {
      socket.join(`conversation:${conversationId}`);
      
      if (!conversationRooms.has(conversationId as string)) {
        conversationRooms.set(conversationId as string, new Set());
      }
      conversationRooms.get(conversationId as string)?.add(socket.id);
    }

    
    if (siteId) {
      socket.join(`site:${siteId}`);
    }

    
    
    

    
    socket.on('join_conversation', async ({ conversationId }) => {
      socket.join(`conversation:${conversationId}`);
      
      const user = connectedUsers.get(socket.id);
      if (user) {
        user.conversationId = conversationId;
      }
      
      if (!conversationRooms.has(conversationId)) {
        conversationRooms.set(conversationId, new Set());
      }
      conversationRooms.get(conversationId)?.add(socket.id);

      
      io.to(`conversation:${conversationId}`).emit('visitor_joined', {
        conversationId,
        sessionId: user?.sessionId
      });
    });

    
    socket.on('user_typing', ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit('visitor_typing', {
        conversationId
      });
    });

    
    socket.on('user_stopped_typing', ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit('visitor_stopped_typing', {
        conversationId
      });
    });

    
    socket.on('conversation_opened', async ({ conversationId }) => {
      try {
        
        const messages = await storage.getConversationMessages(conversationId);
        const unreadMessages = messages.filter(msg => 
          !msg.fromUser && msg.status !== 'read'
        );

        
        for (const msg of unreadMessages) {
          await storage.updateMessage(msg.id, {
            status: 'read',
            readAt: new Date()
          });
        }

        
        await storage.updateConversation(conversationId, {
          unreadCount: 0
        });

        
        socket.to(`conversation:${conversationId}`).emit('messages_read', {
          conversationId,
          messageIds: unreadMessages.map(m => m.id)
        });
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    });

    
    socket.on('message_read', async ({ conversationId, messageId }) => {
      try {
        await storage.updateMessage(messageId, {
          status: 'read',
          readAt: new Date()
        });

        
        socket.to(`conversation:${conversationId}`).emit('message_status_update', {
          messageId,
          status: 'read'
        });
      } catch (error) {
        console.error('Error updating message status:', error);
      }
    });

    
    
    

    
    socket.on('agent_join_conversation', async ({ conversationId, agentId, agentName }) => {
      socket.join(`conversation:${conversationId}`);
      
      const user = connectedUsers.get(socket.id);
      if (user) {
        user.conversationId = conversationId;
        user.userId = agentId;
        user.name = agentName;
        user.role = 'agent';
      }

      if (!conversationRooms.has(conversationId)) {
        conversationRooms.set(conversationId, new Set());
      }
      conversationRooms.get(conversationId)?.add(socket.id);

      
      try {
        await storage.updateConversation(conversationId, {
          status: 'assigned',
          assignedTo: agentId
        });

        
        io.to(`conversation:${conversationId}`).emit('conversation_assigned', {
          conversationId,
          agent: {
            id: agentId,
            name: agentName
          }
        });
      } catch (error) {
        console.error('Error assigning conversation:', error);
      }
    });

    
    socket.on('agent_typing', ({ conversationId, agentName }) => {
      socket.to(`conversation:${conversationId}`).emit('agent_typing', {
        conversationId,
        agentName
      });
    });

    
    socket.on('agent_stopped_typing', ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit('agent_stopped_typing', {
        conversationId
      });
    });

    
    socket.on('agent_send_message', async ({ conversationId, content, agentId, agentName }) => {
      try {
        
        const message = await storage.createMessage({
          conversationId,
          content,
          direction: 'outbound',
          fromUser: false,
          fromType: 'agent',
          type: 'text',
          status: 'sent',
          metadata: {
            agentId,
            agentName
          }
        });

        
        await storage.updateConversation(conversationId, {
          lastMessageAt: new Date(),
          lastMessageText: content,
          updatedAt: new Date()
        });

        
        io.to(`conversation:${conversationId}`).emit('new_message', {
          conversationId,
          message: {
            id: message.id,
            content: message.content,
            fromUser: false,
            fromType: 'agent',
            fromName: agentName,
            createdAt: message.createdAt,
            status: message.status
          }
        });

        
        socket.emit('message_sent', {
          messageId: message.id,
          status: 'sent'
        });

      } catch (error) {
        console.error('Error sending agent message:', error);
        socket.emit('message_error', {
          error: 'Failed to send message'
        });
      }
    });

    
    socket.on('close_conversation', async ({ conversationId, agentId }) => {
      try {
        await storage.updateConversation(conversationId, {
          status: 'closed',
          updatedAt: new Date()
        });

        
        io.to(`conversation:${conversationId}`).emit('conversation_status_changed', {
          conversationId,
          status: 'closed'
        });
      } catch (error) {
        console.error('Error closing conversation:', error);
      }
    });

    
    socket.on('transfer_conversation', async ({ conversationId, fromAgentId, toAgentId, toAgentName }) => {
      try {
        await storage.updateConversation(conversationId, {
          assignedTo: toAgentId,
          updatedAt: new Date()
        });

        
        await storage.createMessage({
          conversationId,
          content: `Conversation transferred to ${toAgentName}`,
          direction: 'outbound',
          fromUser: false,
          fromType: 'system',
          type: 'text',
          status: 'sent'
        });

        
        io.to(`conversation:${conversationId}`).emit('conversation_transferred', {
          conversationId,
          agent: {
            id: toAgentId,
            name: toAgentName
          }
        });
      } catch (error) {
        console.error('Error transferring conversation:', error);
      }
    });

    
    
    

    
    socket.on('broadcast_to_site', ({ siteId, event, data }) => {
      io.to(`site:${siteId}`).emit(event, data);
    });

    
    
    

    socket.on('disconnect', () => {
      console.log('Socket disconnected:', socket.id);

      const user = connectedUsers.get(socket.id);
      if (user?.conversationId) {
        const room = conversationRooms.get(user.conversationId);
        if (room) {
          room.delete(socket.id);
          if (room.size === 0) {
            conversationRooms.delete(user.conversationId);
          }
        }

        
        if (user.role === 'visitor') {
          socket.to(`conversation:${user.conversationId}`).emit('visitor_left', {
            conversationId: user.conversationId
          });
        }
      }

      connectedUsers.delete(socket.id);
    });
  });

  
  io.getOnlineAgents = function(siteId?: string) {
    const agents: SocketUser[] = [];
    connectedUsers.forEach(user => {
      if (user.role === 'agent' || user.role === 'admin') {
        if (!siteId || user.siteId === siteId) {
          agents.push(user);
        }
      }
    });
    return agents;
  };

  
  io.isConversationActive = function(conversationId: string) {
    const room = conversationRooms.get(conversationId);
    return room && room.size > 0;
  };

  return io;
}

export let io: SocketIOServer & {
  getOnlineAgents?: (siteId?: string) => SocketUser[];
  isConversationActive?: (conversationId: string) => boolean;
};

export function setSocketIO(socketServer: SocketIOServer) {
  io = socketServer as any;
}
