import { createManagedUser } from "@/lib/admin-users";

export function createAccount(username: string, password: string, workspaceRoot?: string) {
  try {
    const user = createManagedUser({ username, password, workspaceRoot });
    return { id: user.id, username: user.username, createdAt: user.createdAt, isAdmin: user.isAdmin };
  } catch {
    return null;
  }
}
