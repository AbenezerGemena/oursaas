import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { registerRoutes } from "./routes/index";
import { setupVite, serveStatic, log } from "./vite";
import { MessageStatusUpdater } from "./services/message-status-updater";
import { MessageQueueService } from "./services/message-queue";
import "dotenv/config";
import { initializeUploadsDirectory } from "./middlewares/upload.middleware";
import cors from "cors";
import { rateLimitMiddleware } from "./middlewares/rate-limit.middleware";
import path from "path";
import { createServer } from "http";
import { storage } from "./storage";
import { Server as SocketIOServer } from "socket.io";
import { fetchConversationList } from "./controllers/conversations.controller";
import { startScheduledCampaignCron } from "./cron/scheduledCampaigns.cron";
import { oursaasLogger, OURSAAS_HEADER_KEY, OURSAAS_HEADER_VALUE, OURSAAS_VERSION, OURSAAS_PRODUCT_NAME } from "@oursaas/core";
import { createAdapter } from "@socket.io/redis-adapter";
import { createCorsOriginChecker, parseAllowedOrigins } from "./utils/cors";

const app = express();
const allowedCorsOrigins = parseAllowedOrigins(
  process.env.FRONTEND_ORIGIN,
  process.env.CLIENT_ORIGIN,
  process.env.ALLOWED_ORIGINS
);

app.use(
  cors({
    origin: createCorsOriginChecker(allowedCorsOrigins),
    credentials: true,
  })
);

const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

if (process.env.REDIS_URL) {
  (async () => {
    try {
      const Redis = (await import("ioredis")).default;
      const redisUrl = process.env.REDIS_URL!;

      const redisOpts = {
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
        lazyConnect: true,
        retryStrategy() { return null; },
      };

      const pubClient = new Redis(redisUrl, redisOpts);
      const subClient = new Redis(redisUrl, redisOpts);

      pubClient.on("error", () => { });
      subClient.on("error", () => { });

      const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

      await Promise.all([
        Promise.race([pubClient.connect(), timeout(5000)]),
        Promise.race([subClient.connect(), timeout(5000)]),
      ]);

      io.adapter(createAdapter(pubClient, subClient));
      console.log("[Socket.IO] Redis adapter attached for multi-instance support");
    } catch {
      console.warn("[Socket.IO] Redis not available — using in-memory adapter (this is fine for single-instance)");
    }
  })();
}

(global as any).io = io;

const connectedUsers = new Map();
const conversationRooms = new Map();

io.on("connection", (socket) => {
  console.log("Socket.io client connected:", socket.id);

  const { userId, role, siteId } = socket.handshake.query;

  
  const user = {
    socketId: socket.id,
    userId: userId as string,
    role: (role as string) || "agent",
    siteId: siteId as string,
  };

  connectedUsers.set(socket.id, user);
  console.log(`User connected: ${userId}, Role: ${role}`);

  if (userId) {
    socket.join(`user:${userId}`);
    console.log(`✅ Auto-joined user:${userId} room for notifications`);
  }

  
  if (siteId) {
    socket.join(`site:${siteId}`);
  }

  socket.on("test_event", (data) => {
    console.log("🔥 TEST EVENT RECEIVED:", data);

    socket.emit("test_response", { msg: "Server se response aaya!" });
  });
  socket.on("join-room", ({ room }) => {
    console.log("📥 Socket joined room:", room);
    socket.join(room);
  });

  socket.on("leave-room", ({ room }) => {
    socket.leave(room);
    console.log("📤 Left:", room);
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

  
  
  

  

  socket.on(
    "agent_join_conversation",
    async ({ conversationId, agentId, agentName }) => {
      console.log(`Agent ${agentName} joining conversation ${conversationId}`);

      
      socket.join(`conversation:${conversationId}`);
      socket.join(`conversation_${conversationId}`);  

      const user = connectedUsers.get(socket.id);
      if (user) {
        user.conversationId = conversationId;
        user.agentName = agentName;
      }

      if (!conversationRooms.has(conversationId)) {
        conversationRooms.set(conversationId, new Set());
      }
      conversationRooms.get(conversationId)?.add(socket.id);

      
      socket.to(`conversation:${conversationId}`).emit("agent_joined", {
        conversationId,
        agentId,
        agentName,
      });

      
      try {
        await storage.updateConversation(conversationId, {
          status: "assigned",
          assignedTo: agentId,
          assignedToName: agentName,
        });
      } catch (error) {
        console.error("Error updating conversation:", error);
      }

      console.log(`✅ Agent joined both room formats for ${conversationId}`);
    }
  );
  socket.on(
    "agent_join_conversationOLD",
    async ({ conversationId, agentId, agentName }) => {
      console.log(`Agent ${agentName} joining conversation ${conversationId}`);

      socket.join(`conversation:${conversationId}`);
      socket.join(`conversation_${conversationId}`);

      const user = connectedUsers.get(socket.id);
      if (user) {
        user.conversationId = conversationId;
        user.agentName = agentName;
      }

      if (!conversationRooms.has(conversationId)) {
        conversationRooms.set(conversationId, new Set());
      }
      conversationRooms.get(conversationId)?.add(socket.id);

      
      socket.to(`conversation:${conversationId}`).emit("agent_joined", {
        conversationId,
        agentId,
        agentName,
      });

      
      try {
        
        await storage.updateConversation(conversationId, {
          status: "assigned",
          assignedTo: agentId,
          assignedToName: agentName,
        });
      } catch (error) {
        console.error("Error updating conversation:", error);
      }
    }
  );

  
  socket.on("agent_typing", ({ conversationId, agentName }) => {
    console.log(`Agent typing in ${conversationId}`);
    socket.to(`conversation:${conversationId}`).emit("agent_typing", {
      conversationId,
      agentName,
    });
  });

  
  socket.on("agent_stopped_typing", ({ conversationId }) => {
    socket.to(`conversation:${conversationId}`).emit("agent_stopped_typing", {
      conversationId,
    });
  });

  
  socket.on(
    "agent_send_message",
    async ({ conversationId, content, agentId, agentName }) => {
      console.log(`Agent message in ${conversationId}:`, content);

      try {
        
        const message = {
          id: `msg_${Date.now()}`, 
          conversationId,
          content,
          fromUser: false,
          fromType: "agent",
          fromName: agentName,
          createdAt: new Date().toISOString(),
          status: "sent",
        };

        
        io.to(`conversation:${conversationId}`).emit("new_message", {
          conversationId,
          message,
        });

        
        socket.emit("message_sent", {
          conversationId,
          status: "delivered",
        });
      } catch (error) {
        console.error("Error sending agent message:", error);
        socket.emit("message_error", {
          error: "Failed to send message",
        });
      }
    }
  );

  
  socket.on("close_conversation", async ({ conversationId, agentId }) => {
    console.log(`Closing conversation ${conversationId}`);

    try {
      
      
      
      

      
      io.to(`conversation:${conversationId}`).emit(
        "conversation_status_changed",
        {
          conversationId,
          status: "closed",
        }
      );
    } catch (error) {
      console.error("Error closing conversation:", error);
    }
  });

  socket.on('join_all_conversations', ({ channelId, userId }) => {
    console.log(`✅ JOIN_ALL_CONVERSATIONS: User ${userId} joining channel ${channelId}`);
    socket.join(`channel:${channelId}`);
    socket.join(`user:${userId}`);
    console.log(`✅ Successfully joined channel:${channelId}`);

    socket.emit('joined_channel', {
      channelId,
      userId,
      message: 'Successfully joined channel room'
    });
  });

  socket.on('join_conversation', ({ conversationId, userId }) => {
    console.log(`✅ JOIN_CONVERSATION: ${userId} joining ${conversationId}`);
    socket.join(`conversation_${conversationId}`);
    socket.join(`conversation:${conversationId}`);

    if (!conversationRooms.has(conversationId)) {
      conversationRooms.set(conversationId, new Set());
    }
    conversationRooms.get(conversationId)?.add(socket.id);
    console.log(`✅ Joined conversation_${conversationId}`);
  });

  socket.on('leave_conversation', ({ conversationId, userId }) => {
    socket.leave(`conversation_${conversationId}`);
    socket.leave(`conversation:${conversationId}`);
    const room = conversationRooms.get(conversationId);
    if (room) {
      room.delete(socket.id);
    }
  });
  
  socket.on("user_typing", ({ conversationId }) => {
    socket.to(`conversation:${conversationId}`).emit("user_typing", {
      conversationId,
    });
  });

  
  socket.on("user_stopped_typing", ({ conversationId }) => {
    socket.to(`conversation:${conversationId}`).emit("user_stopped_typing", {
      conversationId,
    });
  });

  
  socket.on("conversation_opened", async ({ conversationId }) => {
    console.log(`Conversation opened: ${conversationId}`);

    try {
      
      await storage.markMessagesAsRead(conversationId);

      socket.to(`conversation:${conversationId}`).emit("messages_read", {
        conversationId,
      });
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  });

  
  socket.on("message_read", async ({ conversationId, messageId }) => {
    try {
      
      await storage.updateMessage(messageId, {
        status: "read",
        readAt: new Date(),
      });

      socket
        .to(`conversation:${conversationId}`)
        .emit("message_status_update", {
          messageId,
          status: "read",
        });
    } catch (error) {
      console.error("Error updating message status:", error);
    }
  });

  
  
  
  socket.on("disconnect", () => {
    console.log("Socket.io client disconnected:", socket.id);

    const user = connectedUsers.get(socket.id);
    if (user?.conversationId) {
      const room = conversationRooms.get(user.conversationId);
      if (room) {
        room.delete(socket.id);
        if (room.size === 0) {
          conversationRooms.delete(user.conversationId);
        }
      }

      
      if (user.role === "visitor") {
        socket.to(`conversation:${user.conversationId}`).emit("user_left", {
          conversationId: user.conversationId,
        });
      }
    }

    connectedUsers.delete(socket.id);
  });
});

io.getOnlineAgents = function (siteId?: string) {
  const agents: any[] = [];
  connectedUsers.forEach((user) => {
    if (user.role === "agent" || user.role === "admin") {
      if (!siteId || user.siteId === siteId) {
        agents.push(user);
      }
    }
  });
  return agents;
};

io.isConversationActive = function (conversationId: string) {
  const room = conversationRooms.get(conversationId);
  return room && room.size > 0;
};

app.use((_req, res, next) => {
  res.setHeader(OURSAAS_HEADER_KEY, OURSAAS_HEADER_VALUE);
  next();
});

app.get("/api/version", (_req, res) => {
  res.json({ version: OURSAAS_VERSION, product: OURSAAS_PRODUCT_NAME });
});

app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use('/webhooks/razorpay', express.raw({ type: 'application/json' }));
app.use('/webhooks/paypal', express.raw({ type: 'application/json' }));
app.use('/webhooks/paystack', express.raw({ type: 'application/json' }));
app.use('/webhooks/mercadopago', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use("/uploads", express.static("uploads"));
app.use("/uploads", express.static(path.join(process.cwd(), "public", "uploads")));

app.use(
  "/widget",
  express.static(path.join(process.cwd(), "public"), {
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    },
  })
);

app.get("/api/agents/online", (req, res) => {
  const { siteId } = req.query;
  const agents = io.getOnlineAgents?.(siteId as string) || [];
  res.json({ agents });
});

initializeUploadsDirectory();

const PostgresSessionStore = connectPgSimple(session);
app.use(
  session({
    store: new PostgresSessionStore({
      pool,
      createTableIfMissing: true,
    }),
    secret:
      process.env.SESSION_SECRET || "your-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, 
    },
  })
);

app.use(rateLimitMiddleware);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  
  
  
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  
  
  
  
  const port = parseInt(process.env.PORT || "5000", 10);

  const listenOptions: any = {
    port,
    host: "0.0.0.0",
  };

  
  if (process.platform !== "win32" && process.env.NODE_ENV !== "production") {
    listenOptions.reusePort = true;
  }

  httpServer.listen(listenOptions, async () => {
    oursaasLogger.banner();
    oursaasLogger.success(`Server running on port ${port}`);

    const instanceId = process.env.NODE_APP_INSTANCE;
    const isCronLeader = !instanceId || instanceId === "0";

    if (isCronLeader) {
      oursaasLogger.success(`Worker ${instanceId ?? "main"} is the cron leader — starting scheduled jobs`);
      startScheduledCampaignCron();

      const messageStatusUpdater = new MessageStatusUpdater();
      messageStatusUpdater.startCronJob(60);

      MessageQueueService.startProcessing();

      const { channelHealthMonitor } = await import(
        "./cron/channel-health-monitor"
      );
      channelHealthMonitor.start();
    } else {
      oursaasLogger.success(`Worker ${instanceId} skipping cron jobs (not the leader)`);
    }
  });
})();
