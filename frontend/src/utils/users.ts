import { DEFAULT_USERS, USERS_KEY } from "../types";
import type { User, UserRole } from "../types";

export function getUsers(): User[] {
  let stored: User[] = [];
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as User[];
      if (Array.isArray(parsed)) stored = parsed;
    }
  } catch {}

  // Garantáljuk, hogy a default felhasználók mindig elérhetők legyenek (admin
  // ne tudjon kizáródni egy régi/sérült localStorage adat miatt). A meglévő,
  // egyező nevű felhasználókat NEM írjuk felül — a saját jelszavuk megmarad.
  let changed = false;
  for (const def of DEFAULT_USERS) {
    if (!stored.some((u) => u.username.toLowerCase() === def.username.toLowerCase())) {
      stored.push(def);
      changed = true;
    }
  }
  if (changed) saveUsers(stored);
  return stored;
}

export function saveUsers(users: User[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function findUser(username: string, password: string): User | null {
  const users = getUsers();
  return (
    users.find(
      (u) =>
        u.username.toLowerCase() === username.toLowerCase() &&
        u.password === password
    ) ?? null
  );
}

export function addUser(
  username: string,
  password: string,
  role: UserRole
): { ok: true; user: User } | { ok: false; error: string } {
  const users = getUsers();
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return { ok: false, error: "Ez a felhasználónév már foglalt." };
  }
  const newUser: User = {
    id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    username: username.trim(),
    password,
    role,
    createdAt: new Date().toISOString(),
  };
  saveUsers([...users, newUser]);
  return { ok: true, user: newUser };
}

export function deleteUser(userId: string): void {
  const users = getUsers().filter((u) => u.id !== userId);
  saveUsers(users);
}

export function updateUserPassword(userId: string, newPassword: string): void {
  const users = getUsers().map((u) =>
    u.id === userId ? { ...u, password: newPassword } : u
  );
  saveUsers(users);
}
