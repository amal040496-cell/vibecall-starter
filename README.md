# VibeCall — anonymous 1-to-1 video chat starter

This is a learning MVP scaffold using Next.js, Supabase RPC/Realtime Broadcast, and browser WebRTC.

## What works in this starter
- No visitor account or password.
- Self-declared 18+ confirmation stored for the current browser tab.
- Camera/microphone preview after the visitor presses Start.
- One-at-a-time random queue matching.
- WebRTC offer/answer/ICE signaling through Supabase Realtime Broadcast.
- Next, End, mic/camera toggles, and a basic report submission.
- Queue cleanup and a simple India-only product label.

## Important limitations before public launch
1. The age checkbox is not age verification. Do not claim that it verifies age.
2. The India label is not IP/country verification or geofencing. This starter matches all visitors in the same queue; add a trusted country-detection layer before claiming India-only matching.
3. This uses a public STUN server only. Some networks require TURN relaying, which may not be available for free at reliable scale. Without TURN, some users will fail to connect.
4. This is not production-hardened. Add rate limiting, abuse prevention, moderator tooling, report review, block lists, abuse response, retention rules, privacy/terms pages, and legal review before public launch.
5. The report function stores a reason and a random session ID; it does not identify the reported person or automatically moderate them.
6. No call recording is implemented. Do not add recording without a clear lawful basis, notice, and consent.
7. Free service tiers have limits and can change. "Free to start" does not mean unlimited or guaranteed zero operating cost.

## Requirements
- Node.js 20.9 or newer
- A Supabase project
- Chrome, Edge, Firefox, or Safari with camera/microphone permissions

## Setup
1. Install Node.js from https://nodejs.org/
2. Create a Supabase project at https://supabase.com/
3. In Supabase, open SQL Editor, paste `supabase/schema.sql`, and run it.
4. In Supabase project settings, copy the Project URL and anon/publishable key.
5. Copy `.env.example` to `.env.local` and fill in those two values.
6. Open a terminal in this folder and run:

   ```bash
   npm install
   npm run dev
   ```

7. Open http://localhost:3000
8. Test with two separate browsers/devices. Both users need to press Start and allow camera/mic access.

## Notes
- `sessionStorage` creates a different anonymous session per tab. Keep the same tab open while testing.
- Camera access requires localhost during development, or HTTPS after deployment.
- The matchmaking SQL is intentionally small for a first prototype. Add expiration/heartbeat logic for matches and a proper queue lease before production.
