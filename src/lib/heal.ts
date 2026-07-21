import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import { firestore } from "./firebase";
import { writeAudit } from "./audit";

/// Mirrors FirestoreService._cyclePeriodDays on the mobile side. Any
/// change here needs the mobile counterpart updated too — a mismatched
/// period turns the cycle counter into a lie.
function cyclePeriodDays(frequency: string): number {
  const f = frequency.toLowerCase();
  if (f === "weekly") return 7;
  if (f === "biweekly" || f === "bi-weekly") return 14;
  return 30;
}

/// Mirrors FirestoreService._timeBasedCycleNumber. `startDate` is the
/// first payout date (end of cycle 1). Today ≤ that → cycle 1;
/// otherwise cycle N based on frequency period.
function timeBasedCycleNumber(
  startDate: Date | null,
  frequency: string,
): number {
  if (!startDate) return 1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  if (today.getTime() <= start.getTime()) return 1;
  const period = cyclePeriodDays(frequency);
  const diffDays = Math.floor(
    (today.getTime() - start.getTime()) / (86400 * 1000),
  );
  return 2 + Math.floor((diffDays - 1) / period);
}

export type HealReport = {
  cycleFixed: boolean;
  adminMemberCreated: boolean;
  slotsCreated: number;
};

/// Runs the three self-heal routines the mobile app runs on Manage
/// Memberships load, but from the super-admin panel where they can be
/// invoked on demand or on a schedule:
///
/// 1. cycle: reset stored `currentCycle` to the time-based value when
///    the two disagree AND no payout exists for the previous cycle
///    (guards against undo-payout leaving the counter stuck).
/// 2. admin member doc: recreate `members/{createdBy}` if missing so
///    the group isn't admin-less.
/// 3. slots: for useSlots groups, add a solo slot for every member
///    who owns none (orphans left by partial wipes or older enrolls).
///
/// Returns a report so callers can display what was fixed.
export async function healGroup(groupId: string): Promise<HealReport> {
  const report: HealReport = {
    cycleFixed: false,
    adminMemberCreated: false,
    slotsCreated: 0,
  };
  const groupRef = doc(firestore, "groups", groupId);
  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();

  // 1. Heal cycle
  const startTs = g.startDate as Timestamp | undefined;
  const startDate = startTs?.toDate() ?? null;
  const frequency = String(g.frequency ?? "monthly");
  const timeBased = timeBasedCycleNumber(startDate, frequency);
  const stored =
    typeof g.currentCycle === "number" ? g.currentCycle : null;
  if (stored !== null && stored > timeBased) {
    const q = query(
      collection(firestore, "groups", groupId, "payments"),
      where("type", "==", "payout"),
      where("cycleNumber", "==", stored - 1),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      await updateDoc(groupRef, { currentCycle: timeBased });
      report.cycleFixed = true;
    }
  }

  // 2. Heal admin member
  const createdBy = String(g.createdBy ?? "");
  if (createdBy) {
    const memberRef = doc(firestore, "groups", groupId, "members", createdBy);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) {
      const userSnap = await getDoc(doc(firestore, "users", createdBy));
      const name = String(userSnap.data()?.name ?? "");
      // Position = tail of the current member list so the admin doesn't
      // steal position 1 from an existing member.
      const membersSnap = await getDocs(
        collection(firestore, "groups", groupId, "members"),
      );
      await setDoc(memberRef, {
        userId: createdBy,
        name,
        role: "admin",
        position: membersSnap.size + 1,
        joinCycle: 1,
        joinedAt: serverTimestamp(),
        payoutCycle: null,
      });
      report.adminMemberCreated = true;
    }
  }

  // 3. Heal slots
  if (g.useSlots === true) {
    const [membersSnap, slotsSnap] = await Promise.all([
      getDocs(collection(firestore, "groups", groupId, "members")),
      getDocs(collection(firestore, "groups", groupId, "slots")),
    ]);
    const ownedUids = new Set<string>();
    for (const d of slotsSnap.docs) {
      const owners =
        (d.data().owners as Array<{ userId: string }> | undefined) ?? [];
      for (const o of owners) ownedUids.add(o.userId);
    }
    const orphans = membersSnap.docs.filter((d) => !ownedUids.has(d.id));
    let nextPos = slotsSnap.size + 1;
    const cycleForSlot =
      typeof g.currentCycle === "number" ? g.currentCycle : 1;
    for (const m of orphans) {
      const md = m.data();
      await setDoc(
        doc(collection(firestore, "groups", groupId, "slots")),
        {
          position: nextPos,
          owners: [
            {
              userId: m.id,
              name: String(md.name ?? ""),
              share: 1.0,
            },
          ],
          joinCycle: cycleForSlot,
        },
      );
      report.slotsCreated++;
      nextPos++;
    }
  }

  await writeAudit({
    action: "heal_group",
    targetType: "group",
    targetId: groupId,
    test: false,
    after: report,
  });

  return report;
}

export type HealAllReport = {
  processed: number;
  cycleFixed: number;
  adminMemberCreated: number;
  slotsCreated: number;
  failed: number;
};

/// Sweep every group and run [healGroup] on each. Errors on individual
/// groups are counted in `failed` rather than aborting the sweep — one
/// broken group shouldn't block healing the rest.
export async function healAllGroups(): Promise<HealAllReport> {
  const groupsSnap = await getDocs(collection(firestore, "groups"));
  const report: HealAllReport = {
    processed: 0,
    cycleFixed: 0,
    adminMemberCreated: 0,
    slotsCreated: 0,
    failed: 0,
  };
  for (const g of groupsSnap.docs) {
    try {
      const r = await healGroup(g.id);
      report.processed++;
      if (r.cycleFixed) report.cycleFixed++;
      if (r.adminMemberCreated) report.adminMemberCreated++;
      report.slotsCreated += r.slotsCreated;
    } catch {
      report.failed++;
    }
  }
  await writeAudit({
    action: "heal_all_groups",
    targetType: "platform",
    targetId: "*",
    test: false,
    after: report,
  });
  return report;
}
