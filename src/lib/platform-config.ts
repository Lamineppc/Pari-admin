import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { firestore } from "./firebase";
import { writeAudit } from "./audit";

export type MarketplaceConfig = {
  feePercent: number;
};

const DEFAULT_FEE_PCT = 10;

export function subscribeMarketplaceConfig(
  cb: (cfg: MarketplaceConfig) => void,
) {
  return onSnapshot(
    doc(firestore, "platform_config", "marketplace"),
    (snap) => {
      const raw = snap.data()?.feePercent;
      const v = typeof raw === "number" ? raw : DEFAULT_FEE_PCT;
      cb({ feePercent: v });
    },
  );
}

export async function fetchMarketplaceFeePercent(): Promise<number> {
  const snap = await getDoc(doc(firestore, "platform_config", "marketplace"));
  const v = snap.data()?.feePercent;
  return typeof v === "number" ? v : DEFAULT_FEE_PCT;
}

export async function setMarketplaceFeePercent(pct: number): Promise<void> {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error("Fee % must be between 0 and 100.");
  }
  await setDoc(
    doc(firestore, "platform_config", "marketplace"),
    { feePercent: pct, updatedAt: serverTimestamp() },
    { merge: true },
  );
  await writeAudit({
    action: "set_platform_config",
    targetType: "platform",
    targetId: "marketplace",
    test: false,
    after: { feePercent: pct },
  });
}
