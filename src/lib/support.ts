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

function toDateSafe(x: unknown): Date | null {
  if (!x) return null;
  if (typeof x === "string") {
    const d = new Date(x);
    return isNaN(d.getTime()) ? null : d;
  }
  const maybeTs = x as { toDate?: () => Date };
  if (typeof maybeTs.toDate === "function") return maybeTs.toDate();
  return null;
}

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
    createdAt: toDateSafe(d.createdAt),
    updatedAt: toDateSafe(d.updatedAt),
    assignedTo: (d.assignedTo as string | undefined) ?? null,
    resolvedAt: toDateSafe(d.resolvedAt),
    internalNotes: notes.map((n) => ({
      authorUid: (n.authorUid as string | undefined) ?? "",
      authorEmail: (n.authorEmail as string | undefined) ?? "",
      body: (n.body as string | undefined) ?? "",
      createdAt: toDateSafe(n.createdAt),
    })),
    lastReply: (d.lastReply as string | undefined) ?? null,
    lastReplyAt: toDateSafe(d.lastReplyAt),
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
    (s) => {
      // eslint-disable-next-line no-console
      console.log("[support] subscribeTickets snapshot size=", s.size, "empty=", s.empty);
      cb(s.docs.map(toTicket));
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error("[support] subscribeTickets error", err.code, err.message);
      onError?.(err);
    },
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

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

async function notifyOwner(
  userId: string,
  subject: string,
  ticketId: string,
  type: string,
  body: string,
): Promise<void> {
  await addDoc(collection(firestore, "users", userId, "notifications"), {
    type,
    title: `Support: ${subject}`,
    body,
    isRead: false,
    createdAt: serverTimestamp(),
    ticketId,
  });
}

export async function setTicketStatus(
  ticketId: string,
  status: TicketStatus,
): Promise<void> {
  const ref = doc(firestore, COLLECTION, ticketId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Ticket not found.");
  const t = snap.data();
  const prev = (t.status as TicketStatus | undefined) ?? "open";
  if (prev === status) return;

  await updateDoc(ref, {
    status,
    updatedAt: serverTimestamp(),
    ...(status === "resolved" || status === "closed"
      ? { resolvedAt: serverTimestamp() }
      : {}),
  });

  const userId = (t.userId as string | undefined) ?? "";
  const subject = (t.subject as string | undefined) ?? "";
  if (userId) {
    await notifyOwner(
      userId,
      subject,
      ticketId,
      "support_status",
      `Status changed to ${STATUS_LABEL[status]}.`,
    );
  }
}

export async function setTicketPriority(
  ticketId: string,
  priority: TicketPriority,
): Promise<void> {
  const ref = doc(firestore, COLLECTION, ticketId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Ticket not found.");
  const t = snap.data();
  const prev = (t.priority as TicketPriority | undefined) ?? "normal";
  if (prev === priority) return;

  await updateDoc(ref, {
    priority,
    updatedAt: serverTimestamp(),
  });

  const userId = (t.userId as string | undefined) ?? "";
  const subject = (t.subject as string | undefined) ?? "";
  if (userId) {
    await notifyOwner(
      userId,
      subject,
      ticketId,
      "support_priority",
      `Priority set to ${PRIORITY_LABEL[priority]}.`,
    );
  }
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
  await notifyOwner(userId, subject, ticketId, "support_reply", body.trim());

  await updateDoc(ref, {
    lastReply: body.trim(),
    lastReplyAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
