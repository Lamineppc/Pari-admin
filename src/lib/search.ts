// Global search — fetches everything once, filters client-side. Fine
// for the admin-panel scale (dozens–hundreds of each entity). If any
// collection outgrows that, swap the specific stream for server-side
// prefix queries.

import { collection, getDocs, query, where } from "firebase/firestore";
import { firestore } from "./firebase";

export type SearchResult =
  | {
      kind: "group";
      id: string;
      title: string;
      subtitle: string;
    }
  | {
      kind: "user";
      id: string;
      title: string;
      subtitle: string;
    }
  | {
      kind: "store";
      id: string;
      title: string;
      subtitle: string;
    };

/**
 * Runs a lightweight full-scan search across the three main entity
 * collections. Case-insensitive substring match against a few key
 * fields per collection. Bounded by [max] to keep the payload small
 * on partial matches.
 */
export async function search(
  q: string,
  max: number = 8,
): Promise<{
  groups: SearchResult[];
  users: SearchResult[];
  stores: SearchResult[];
}> {
  const needle = q.trim().toLowerCase();
  if (needle.length === 0) return { groups: [], users: [], stores: [] };

  // Groups: name / id / inviteCode / createdBy
  // Users:  name / email / username / uid
  // Stores: storeName / ownerName / ownerId
  const [groupsSnap, usersSnap, storesSnap] = await Promise.all([
    getDocs(collection(firestore, "groups")),
    getDocs(collection(firestore, "users")),
    getDocs(collection(firestore, "stores")).catch(() => null),
  ]);

  const groups: SearchResult[] = [];
  for (const d of groupsSnap.docs) {
    const data = d.data();
    const name = String(data.name ?? "");
    const inviteCode = String(data.inviteCode ?? "");
    const createdBy = String(data.createdBy ?? "");
    const hay = `${name} ${d.id} ${inviteCode} ${createdBy}`.toLowerCase();
    if (hay.includes(needle)) {
      groups.push({
        kind: "group",
        id: d.id,
        title: name || d.id,
        subtitle: `${data.type ?? "traditional"} · ${data.memberCount ?? 0} members${inviteCode ? ` · ${inviteCode}` : ""}`,
      });
      if (groups.length >= max) break;
    }
  }

  const users: SearchResult[] = [];
  for (const d of usersSnap.docs) {
    const data = d.data();
    const name = String(data.name ?? "");
    const email = String(data.email ?? "");
    const username = String(data.username ?? "");
    const hay = `${name} ${email} ${username} ${d.id}`.toLowerCase();
    if (hay.includes(needle)) {
      users.push({
        kind: "user",
        id: d.id,
        title: name || email || d.id,
        subtitle: `${email || d.id}${username ? ` · @${username}` : ""}${data.isTestAccount ? " · test" : ""}`,
      });
      if (users.length >= max) break;
    }
  }

  const stores: SearchResult[] = [];
  if (storesSnap) {
    for (const d of storesSnap.docs) {
      const data = d.data();
      const storeName = String(data.storeName ?? "");
      const ownerName = String(data.ownerName ?? "");
      const ownerId = String(data.ownerId ?? "");
      const hay = `${storeName} ${ownerName} ${ownerId} ${d.id}`.toLowerCase();
      if (hay.includes(needle)) {
        stores.push({
          kind: "store",
          id: d.id,
          title: storeName || d.id,
          subtitle: `${ownerName} · ${data.status ?? "pending"}`,
        });
        if (stores.length >= max) break;
      }
    }
  }

  return { groups, users, stores };
}

/**
 * Also do an exact-lookup pass for pasted IDs / codes. Useful when
 * pasting a Firestore doc ID that wouldn't match a substring search
 * (because we scanned only the first N docs). Returns the first match
 * of any kind, if found.
 */
export async function exactLookup(q: string): Promise<SearchResult | null> {
  const needle = q.trim();
  if (needle.length === 0) return null;

  // Groups: by inviteCode (uppercased convention)
  const inviteSnap = await getDocs(
    query(
      collection(firestore, "groups"),
      where("inviteCode", "==", needle.toUpperCase()),
    ),
  ).catch(() => null);
  if (inviteSnap && inviteSnap.size > 0) {
    const d = inviteSnap.docs[0];
    return {
      kind: "group",
      id: d.id,
      title: String(d.data().name ?? d.id),
      subtitle: `Invite code ${needle.toUpperCase()}`,
    };
  }
  return null;
}
