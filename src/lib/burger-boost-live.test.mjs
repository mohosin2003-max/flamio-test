import { describe, expect, test } from "bun:test";
import { generateTrack, sanitizeGates, simulateBurgerBoostReplay, RULES_VERSION } from "./burger-boost-rules.ts";
import { createLiveGame, buildLiveSubmission, once, passGate, switchLane, createGame } from "./burger-boost-game.ts";

const SEED = 123456789n;
const track = generateTrack(SEED, RULES_VERSION, 30);
const live = { sessionId: "11111111-1111-4111-8111-111111111111", publicGates: sanitizeGates(track), expiresAt: 0 };

describe("STEP 46D live session", () => {
  test("public gates hide correctLane but show spoiledLane", () => {
    const json = JSON.stringify(live.publicGates);
    expect(json).not.toMatch(/correctLane|seed/);
    expect(live.publicGates.filter((g) => g.kind === "negative").every((g) => g.spoiledLane === 0 || g.spoiledLane === 1)).toBe(true);
  });
  test("live game renders exactly the server gates", () => {
    const s = createLiveGame(live);
    expect(s.track).toEqual(track);
  });
  test("malformed or wrong-length gates fail closed", () => {
    expect(createLiveGame({ ...live, publicGates: live.publicGates.slice(0, 29) })).toBeNull();
    expect(createLiveGame({ ...live, publicGates: [{ kind: "bogus" }, ...live.publicGates.slice(1)] })).toBeNull();
  });
  test("submission carries sessionId + raw actions only, matching server replay", () => {
    let s = createLiveGame(live);
    for (let i = 0; i < 30; i++) {
      const g = s.track[i];
      s = switchLane(s, g.kind === "math" ? g.correctLane : g.kind === "negative" ? 1 - g.spoiledLane : 0);
      s = passGate(s, i * 1000).state;
    }
    const sub = buildLiveSubmission(live.sessionId, s);
    expect(Object.keys(sub).sort()).toEqual(["playerActions", "sessionId"]);
    expect(sub.sessionId).toBe(live.sessionId);
    expect(JSON.stringify(sub)).not.toMatch(/score|discount|seed|completedAt/i);
    expect(simulateBurgerBoostReplay(SEED, 30, sub.playerActions).valid).toBe(true);
  });
  test("incomplete run produces no submission (expire path)", () => {
    expect(buildLiveSubmission(live.sessionId, createLiveGame(live))).toBeNull();
  });
  test("completion submits only once", async () => {
    let n = 0; const f = once(async () => ++n);
    await Promise.all([f(), f(), f()]);
    expect(n).toBe(1);
  });
  test("practice mode unchanged", () => {
    expect(createGame(SEED).track).toEqual(track);
  });
});
