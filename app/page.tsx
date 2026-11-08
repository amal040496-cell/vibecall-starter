"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Match = { room_id: string; peer_id: string };
type Signal = { from: string; type: "offer" | "answer" | "ice"; data: RTCSessionDescriptionInit | RTCIceCandidateInit };

const newSessionId = () => {
  const existing = sessionStorage.getItem("vibecall-session");
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem("vibecall-session", id);
  return id;
};

export default function Home() {
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const sessionId = useRef("");
  const poller = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const handledOffer = useRef(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [ageChecked, setAgeChecked] = useState(false);
  const [status, setStatus] = useState("Confirm that you are 18 or older to continue.");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setAgeChecked(sessionStorage.getItem("vibecall-age") === "yes");
  }, []);

  useEffect(() => {
    return () => { void cleanup(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cleanup(notify = true) {
    if (poller.current) clearInterval(poller.current);
    poller.current = null;
    if (notify && supabase && sessionId.current) {
      await supabase.rpc("leave_chat", { p_session_id: sessionId.current });
    }
    if (channel.current && supabase) {
      await supabase.removeChannel(channel.current);
      channel.current = null;
    }
    pc.current?.close();
    pc.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    setConnected(false);
    setBusy(false);
    pendingIce.current = [];
  }

  async function ensureMedia() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access requires HTTPS or localhost and a supported browser.");
    }
    const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.current = media;
    if (localVideo.current) localVideo.current.srcObject = media;
  }

  async function connectToMatch(match: Match) {
    if (!supabase || !stream.current) return;
    setStatus("Connecting your video...");
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    pc.current = peer;
    stream.current.getTracks().forEach((track) => peer.addTrack(track, stream.current!));
    peer.ontrack = (event) => {
      if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0];
    };
    peer.onicecandidate = (event) => {
      if (event.candidate && channel.current) {
        void channel.current.send({
          type: "broadcast", event: "signal",
          payload: { from: sessionId.current, type: "ice", data: event.candidate.toJSON() }
        });
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        setConnected(true); setBusy(false); setStatus("You're connected. Say hello!");
      }
      if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
        setConnected(false);
        if (peer.connectionState === "failed") setStatus("Connection failed. Try Next.");
      }
    };

    const roomChannel = supabase.channel(`room:${match.room_id}`, {
      config: { broadcast: { self: false } }
    });
    channel.current = roomChannel;

    roomChannel.on("broadcast", { event: "signal" }, async ({ payload }) => {
      const signal = payload as Signal;
      if (!signal || signal.from === sessionId.current || !pc.current) return;
      try {
        if (signal.type === "offer") {
          await pc.current.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
          const answer = await pc.current.createAnswer();
          await pc.current.setLocalDescription(answer);
          await roomChannel.send({ type: "broadcast", event: "signal",
            payload: { from: sessionId.current, type: "answer", data: answer } });
          for (const candidate of pendingIce.current) await pc.current.addIceCandidate(candidate);
          pendingIce.current = [];
        } else if (signal.type === "answer") {
          await pc.current.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
          for (const candidate of pendingIce.current) await pc.current.addIceCandidate(candidate);
          pendingIce.current = [];
        } else if (signal.type === "ice") {
          const candidate = signal.data as RTCIceCandidateInit;
          if (pc.current.remoteDescription) await pc.current.addIceCandidate(candidate);
          else pendingIce.current.push(candidate);
        }
      } catch (e) {
        console.error("Signaling error", e);
        setError("Could not establish the video connection. Please try Next.");
      }
    });

    roomChannel.subscribe(async (state) => {
      if (state !== "SUBSCRIBED") return;
      // Deterministically select one caller so both browsers do not create offers.
      if (sessionId.current < match.peer_id && pc.current?.signalingState === "stable") {
        const offer = await pc.current.createOffer();
        await pc.current.setLocalDescription(offer);
        const offerPayload = { from: sessionId.current, type: "offer" as const, data: offer };
        // A few retries help if the other browser is still subscribing to the room.
        for (let attempt = 0; attempt < 4; attempt++) {
          window.setTimeout(() => {
            if (pc.current && pc.current.signalingState !== "closed") {
              void roomChannel.send({ type: "broadcast", event: "signal", payload: offerPayload });
            }
          }, attempt * 900);
        }
      }
    });
  }

  async function startChat() {
    if (!supabase) {
      setError("Add your Supabase URL and anon key to .env.local, then restart the app.");
      return;
    }
    setError(""); setBusy(true); setConnected(false);
    try {
      sessionId.current = newSessionId();
      await ensureMedia();
      setStatus("Finding someone in India...");
      const first = await supabase.rpc("find_match", { p_session_id: sessionId.current });
      if (first.error) throw first.error;
      if (first.data?.[0]?.room_id) {
        await connectToMatch(first.data[0] as Match);
        return;
      }
      setStatus("Waiting for another person to join...");
      poller.current = setInterval(async () => {
        const result = await supabase!.rpc("get_my_match", { p_session_id: sessionId.current });
        if (result.error) {
          setError("Matchmaking error. Please try again.");
          await cleanup(true);
          return;
        }
        const match = result.data?.[0] as Match | undefined;
        if (match?.room_id) {
          if (poller.current) clearInterval(poller.current);
          poller.current = null;
          await connectToMatch(match);
        }
      }, 1800);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong.";
      setError(message);
      setStatus("Unable to start. Check camera permissions and try again.");
      await cleanup(true);
    }
  }

  async function nextStranger() {
    await cleanup(true);
    setError("");
    setStatus("Looking for your next stranger...");
    await startChat();
  }

  function toggleMic() {
    const next = !micOn; setMicOn(next);
    stream.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
  }
  function toggleCamera() {
    const next = !cameraOn; setCameraOn(next);
    stream.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
  }

  async function reportUser() {
    if (!supabase || !sessionId.current) return;
    const reason = window.prompt("Briefly describe why you are reporting this user:");
    if (!reason?.trim()) return;
    const { error: reportError } = await supabase.rpc("submit_report", {
      p_session_id: sessionId.current, p_reason: reason.trim().slice(0, 500)
    });
    if (reportError) setError("Report could not be submitted. Please disconnect and try again.");
    else { setStatus("Report submitted. Ending this chat."); await cleanup(true); }
  }

  function confirmAge() {
    if (!ageConfirmed) return;
    sessionStorage.setItem("vibecall-age", "yes");
    setAgeChecked(true);
    setStatus("Ready when you are. Camera access starts only when you press Start.");
  }

  return (
    <main className="page">
      {!ageChecked && <div className="age"><div className="ageBox">
        <div className="brand">Vibe<span>Call</span></div>
        <h2>Adults only (18+)</h2>
        <p>This service is intended only for adults aged 18 or older. Do not continue if you are under 18.</p>
        <label className="check"><input type="checkbox" checked={ageConfirmed} onChange={e => setAgeConfirmed(e.target.checked)} />
          I confirm that I am at least 18 years old and agree to follow the community rules.</label>
        <button className="btn primary" disabled={!ageConfirmed} onClick={confirmAge}>Continue</button>
      </div></div>}
      <div className="wrap">
        <header className="top"><div className="brand">Vibe<span>Call</span></div><div className="pill">● Anonymous · 18+</div></header>
        <section className="hero"><h1>Meet someone new.</h1><p>One conversation at a time. No account. No payment.</p></section>
        <section className="videos">
          <div className="videoCard">
            <video ref={localVideo} autoPlay muted playsInline />
            <div className="videoLabel">You</div>
          </div>
          <div className="videoCard">
            <video ref={remoteVideo} autoPlay playsInline />
            {!connected && <div className="placeholder"><div className="avatar">✦</div><strong>{busy ? "Finding a stranger..." : "Your next conversation"}</strong><span>They'll appear here when connected.</span></div>}
            <div className="videoLabel">Stranger</div>
          </div>
        </section>
        <div className="actions">
          {!busy && !connected ? <button className="btn primary" onClick={startChat}>Start video chat</button> : null}
          {(busy || connected) && <button className="btn primary" onClick={nextStranger}>Next stranger →</button>}
          {(busy || connected) && <button className="btn" onClick={() => { void cleanup(true); setStatus("Call ended."); }}>End call</button>}
          <button className="btn small" disabled={!stream.current} onClick={toggleMic}>{micOn ? "Mic on" : "Mic off"}</button>
          <button className="btn small" disabled={!stream.current} onClick={toggleCamera}>{cameraOn ? "Camera on" : "Camera off"}</button>
          <button className="btn small danger" disabled={!connected} onClick={reportUser}>Report</button>
        </div>
        <div className="status" aria-live="polite">{status}</div>
        {error && <div className="error">{error}</div>}
        <div className="notice"><strong>Safety first:</strong> 18+ only. Never share your address, phone number, passwords or financial details. Leave and report abusive behaviour. This starter uses a simple self-declared age gate; it does not verify age. It does not record calls. Reports are stored for review, but a real public launch needs a staffed moderation process, stronger abuse prevention and a proper privacy policy.</div>
      </div>
    </main>
  );
}
