import { db } from "../db";
import { eq, desc, and } from "drizzle-orm";
import { 
  users, 
  type User, 
  type InsertUser 
} from "@shared/schema";

export class UserRepository {
  async getById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getByPermissions(id: string): Promise<User["permissions"] | undefined> {
    const [result] = await db
      .select({ permissions: users.permissions })
      .from(users)
      .where(eq(users.id, id));
  
    return result?.permissions || [];
  }
  

  async getByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }
  

  async create(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getAll(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getTeamUsersCountByCreator(createdBy: string): Promise<number> {
  const result = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.createdBy, createdBy),
        eq(users.role, "team")
      )
    );

  return result.length;
}

}
