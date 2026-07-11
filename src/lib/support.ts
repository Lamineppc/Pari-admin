// Support inbox — user-reported issues surface here as tickets. Mobile app
// will grow a "Contact support" flow later that creates tickets directly;
// meanwhile super admin can create tickets on behalf of users (email/call
// intake) via the "Create ticket" dialog on the panel.

import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { firebaseAuth, firestore } from "./firebase";

const COLLECTION = "support_tickets";

export type TicketCategory =
  | "money"
  | "group"
  | "store"
  | "account"
  | "other";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export type InternalNote = {
  authorUid: string;
  authorEmail: string;
  body: string;
  createdAt: Date | null;
};

export type SupportTicket = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  subject: string;
  body: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  groupId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  assignedTo: string | null;
  resolvedAt: Date | null;
  internalNotes: InternalNote[];
  lastReply: string | null;
  lastReplyAt: Date | null;
};

function toTicket(snap: QueryDocumentSnapshot): SupportTicket {
  const d = snap.data();
  const notes = (d.internalNotes as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    id: snap.id,
    userId: (d.userId as string | undefined) ?? "",
    userName: (d.userName as string | undefined) ?? "",
    userEmail: (d.userEmail as string | undefined) ?? "",
    subject: (d.subject as string | undefined) ?? "",
    body: (d.body as string | undefined) ?? "",
    category: (d.category as TicketCategory | undefined) ?? "other",
    status: (d.status as TicketStatus | undefined) ?? "open",
    priority: (d.priority as TicketPriority | undefined) ?? "normal",
    groupId: (d.groupId as string | undefined) ?? null,
    createdAt: (d.createdAt as Timestamp | undefined)?.toDate() ?? null,
    updatedAt: (d.updatedAt as Timestamp | undefined)?.toDate() ?? null,
    assignedTo: (d.assignedTo as string | undefined) ?? null,
    resolvedAt: (d.resolvedAt as Timestamp | undefined)?.toDate() ?? null,
    internalNotes: notes.map((n) => ({
      authorUid: (n.authorUid as string | undefined) ?? "",
      authorEmail: (n.authorEmail as string | undefined) ?? "",
      body: (n.body as string | undefined) ?? "",
      createdAt: (n.createdAt as Timestamp | undefined)?.toDate() ?? null,
    })),
    lastReply: (d.lastReply as string | undefined) ?? null,
    lastReplyAt: (d.lastReplyAt as Timestamp | undefined)?.toDate() ?? null,
  };
}

export function subscribeTickets(
  cb: (tickets: SupportTicket[]) => void,
  onError?: (e: Error) => void,
) {
  const q = query(
    collection(firestore, COLLECTION),
    orderBy("updatedAt", "desc"),
  );
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toTicket)),
    (err) => onError?.(err),
  );
}

/** Super admin creates a ticket on behalf of a user (email/phone intake). */
export async function createTicket(args: {
  userId: string;
  userName: string;
  userEmail: string;
  subject: string;
  body: string;
  category: TicketCategory;
  priority?: TicketPriority;
  groupId?: string;
}): Promise<string> {
  const ref = await addDoc(collection(firestore, COLLECTION), {
    userId: args.userId,
    userName: args.userName,
    userEmail: args.userEmail,
    subject: args.subject.trim(),
    body: args.body.trim(),
    category: args.category,
    status: "open",
    priority: args.priority ?? "normal",
    ...(args.groupId ? { groupId: args.groupId } : {}),
    internalNotes: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // Tickets are their own audit trail — no writeAudit call needed here.
  return ref.id;
}

export async function setTicketStatus(
  ticketId: string,
  status: TicketStatus,
): Promise<void> {
  await updateDoc(doc(firestore, COLLECTION, ticketId), {
    status,
    updatedAt: serverTimestamp(),
    ...(status === "resolved" || status === "closed"
      ? { resolvedAt: serverTimestamp() }
      : {}),
  });
}

export async function setTicketPriority(
  ticketId: string,
  priority: TicketPriority,
): Promise<void> {
  await updateDoc(doc(firestore, COLLECTION, ticketId), {
    priority,
    updatedAt: serverTimestamp(),
  });
}

export async function addInternalNote(
  ticketId: string,
  body: string,
): Promise<void> {
  const actor = firebaseAuth.currentUser;
  if (!actor) throw new Error("Not signed in.");
  const ref = doc(firestore, COLLECTION, ticketId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Ticket not found.");
  const existing =
    (snap.data().internalNotes as Array<Record<string, unknown>>) ?? [];
  const note = {
    authorUid: actor.uid,
    authorEmail: actor.email ?? "",
    body: body.trim(),
    createdAt: new Date().toISOString(),
  };
  await updateDoc(ref, {
    internalNotes: [...existing, note],
    updatedAt: serverTimestamp(),
  });
}

/** Sends a reply back to the ticket owner as an in-app notification and
 *  records the reply text on the ticket for history. */
export async function replyToTicket(
  ticketId: string,
  body: string,
): Promise<void> {
  const ref = doc(firestore, COLLECTION, ticketId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Ticket not found.");
  const t = snap.data();
  const userId = (t.userId as string | undefined) ?? "";
  const subject = (t.subject as string | undefined) ?? "";
  if (!userId) throw new Error("Ticket has no target user.");

  // Reply is a normal in-app notification that references the ticket.
  await addDoc(collection(firestore, "users", userId, "notifications"), {
    type: "support_reply",
    title: `Support: ${subject}`,
    body: body.trim(),
    isRead: false,
    createdAt: serverTimestamp(),
    ticketId,
  });

  await updateDoc(ref, {
    lastReply: body.trim(),
    lastReplyAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
