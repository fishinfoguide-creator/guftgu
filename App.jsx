import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Send, LogOut, Search, MessageCircle, Users, Loader2, CircleUserRound, Plus, X,
  Paperclip, Download, FileText, Mic, Square, Phone, Video, PhoneOff, MicOff, VideoOff,
  Mail, Calendar, Camera, ArrowLeft, Pencil, ShieldCheck,
} from "lucide-react";

// ---------- storage helpers ----------
const safeGet = async (key, shared = true) => {
  try {
    const res = await window.storage.get(key, shared);
    return res ? JSON.parse(res.value) : null;
  } catch {
    return null;
  }
};
const safeSet = async (key, value, shared = true) => {
  try {
    await window.storage.set(key, JSON.stringify(value), shared);
    return true;
  } catch {
    return false;
  }
};
const safeDelete = async (key, shared = true) => {
  try {
    await window.storage.delete(key, shared);
  } catch {
    /* ignore */
  }
};

const pairKey = (a, b) => "msgs:" + [a, b].sort().join("::");
const uid = () => Math.random().toString(36).slice(2, 10);

const formatLastSeen = (ts) => {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const MAX_FILE_BYTES = 3 * 1024 * 1024;

const normalizePhone = (raw) => raw.replace(/[^\d+]/g, "");
const genOtp = () => String(Math.floor(100000 + Math.random() * 900000));

// downscale + convert an image file to a small base64 data URL
const resizeImageFile = (file, maxDim = 320) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("image load failed"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

export default function Guftgu() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [authStep, setAuthStep] = useState("phone"); // phone | otp | profile
  const [form, setForm] = useState({ phone: "", otp: "", displayName: "", email: "", dob: "", description: "" });
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [devOtp, setDevOtp] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [avatarDraft, setAvatarDraft] = useState(null);
  const [avatarError, setAvatarError] = useState("");

  const [directory, setDirectory] = useState({}); // phone -> {displayName, email, dob, description, avatar}
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  const [chats, setChats] = useState([]);
  const [groups, setGroups] = useState([]);
  const [active, setActive] = useState(null);
  const [searchName, setSearchName] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searchStatus, setSearchStatus] = useState("");

  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupMembersInput, setGroupMembersInput] = useState("");
  const [groupError, setGroupError] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);

  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [pendingFile, setPendingFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const [presence, setPresence] = useState({});

  // ---- calling state ----
  const [callState, setCallState] = useState("idle"); // idle | calling | ringing | in-call
  const [callInfo, setCallInfo] = useState(null); // { id, peer, type, isCaller }
  const [incomingCall, setIncomingCall] = useState(null); // { id, caller, type }
  const [callDuration, setCallDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callError, setCallError] = useState("");

  const bottomRef = useRef(null);
  const pollRef = useRef(null);
  const chatsPollRef = useRef(null);
  const heartbeatRef = useRef(null);
  const presencePollRef = useRef(null);
  const fileInputRef = useRef(null);
  const avatarInputRef = useRef(null);
  const editAvatarInputRef = useRef(null);
  const resendTimerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const recordStreamRef = useRef(null);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const incomingPollRef = useRef(null);
  const callDocPollRef = useRef(null);
  const callDurationRef = useRef(null);
  const seenIncomingIdRef = useRef(null);
  const handledIncomingRef = useRef(new Set());

  const ONLINE_WINDOW_MS = 12000;
  const isOnline = (ts) => typeof ts === "number" && Date.now() - ts < ONLINE_WINDOW_MS;

  useEffect(() => {
    setBooting(false);
  }, []);

  // ---------- auth: phone number + OTP (WhatsApp-style) ----------
  const startResendCooldown = () => {
    setResendIn(30);
    clearInterval(resendTimerRef.current);
    resendTimerRef.current = setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) { clearInterval(resendTimerRef.current); return 0; }
        return s - 1;
      });
    }, 1000);
  };

  const sendOtp = async () => {
    setAuthError("");
    const phone = normalizePhone(form.phone);
    const digitCount = phone.replace(/\D/g, "").length;
    if (digitCount < 7) {
      setAuthError("Please enter a valid mobile number with country code, e.g. +923001234567.");
      return;
    }
    setBusy(true);
    try {
      const code = genOtp();
      await safeSet(`otp:${phone}`, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
      setForm((f) => ({ ...f, phone, otp: "" }));
      setDevOtp(code);
      setAuthStep("otp");
      startResendCooldown();
    } finally {
      setBusy(false);
    }
  };

  const resendOtp = async () => {
    if (resendIn > 0 || busy) return;
    setAuthError("");
    setBusy(true);
    try {
      const code = genOtp();
      await safeSet(`otp:${form.phone}`, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
      setDevOtp(code);
      startResendCooldown();
    } finally {
      setBusy(false);
    }
  };

  const changeNumber = () => {
    clearInterval(resendTimerRef.current);
    setAuthStep("phone");
    setAuthError("");
    setDevOtp("");
    setResendIn(0);
    setForm((f) => ({ ...f, otp: "" }));
  };

  const verifyOtp = async () => {
    setAuthError("");
    const code = form.otp.trim();
    if (code.length !== 6) {
      setAuthError("Please enter the 6-digit OTP code.");
      return;
    }
    setBusy(true);
    try {
      const record = await safeGet(`otp:${form.phone}`);
      if (!record || Date.now() > record.expiresAt) {
        setAuthError("This OTP has expired. Please request a new one.");
        setBusy(false);
        return;
      }
      if (record.code !== code) {
        setAuthError("Incorrect OTP code.");
        setBusy(false);
        return;
      }
      await safeDelete(`otp:${form.phone}`);
      clearInterval(resendTimerRef.current);
      const existing = await safeGet(`user:${form.phone}`);
      if (existing) {
        setUser(existing);
        setDirectory((d) => ({ ...d, [existing.username]: existing }));
      } else {
        setAuthStep("profile");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAvatarSelect = async (e, target) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setAvatarError("");
    if (!file.type.startsWith("image/")) { setAvatarError("Please select an image file."); return; }
    try {
      const dataUrl = await resizeImageFile(file, 320);
      if (target === "edit") setEditForm((f) => ({ ...f, avatar: dataUrl }));
      else setAvatarDraft(dataUrl);
    } catch {
      setAvatarError("Could not load the image. Please try again.");
    }
  };

  const submitProfile = async () => {
    setAuthError("");
    const displayName = form.displayName.trim();
    if (!displayName) {
      setAuthError("Please enter your name.");
      return;
    }
    setBusy(true);
    try {
      const record = {
        username: form.phone,
        phone: form.phone,
        displayName,
        email: form.email.trim(),
        dob: form.dob,
        description: form.description.trim(),
        avatar: avatarDraft || null,
        createdAt: Date.now(),
      };
      await safeSet(`user:${form.phone}`, record);
      await safeSet(`chats:${form.phone}`, []);
      await safeSet(`usergroups:${form.phone}`, []);
      setUser(record);
      setDirectory((d) => ({ ...d, [record.username]: record }));
    } finally {
      setBusy(false);
    }
  };

  // ---------- contact directory (names/avatars for phone-number ids) ----------
  const ensureContacts = useCallback(async (phones) => {
    const missing = Array.from(new Set(phones)).filter((p) => p && !directory[p]);
    if (missing.length === 0) return;
    const updates = {};
    for (const p of missing) {
      const rec = await safeGet(`user:${p}`);
      if (rec) updates[p] = rec;
    }
    if (Object.keys(updates).length) setDirectory((d) => ({ ...d, ...updates }));
  }, [directory]);

  const getName = (phone) => (directory[phone] && directory[phone].displayName) || phone;
  const getAvatar = (phone) => directory[phone] && directory[phone].avatar;
  const initialsFor = (phone) => getName(phone).slice(0, 2).toUpperCase();

  const openEditProfile = () => {
    setEditForm({ ...user });
    setEditError("");
    setShowEditProfile(true);
  };

  const saveEditProfile = async () => {
    setEditError("");
    const displayName = (editForm.displayName || "").trim();
    if (!displayName) { setEditError("Name cannot be empty."); return; }
    setEditBusy(true);
    try {
      const updated = { ...user, displayName, email: (editForm.email || "").trim(), dob: editForm.dob || "", description: (editForm.description || "").trim(), avatar: editForm.avatar || null };
      await safeSet(`user:${user.username}`, updated);
      setUser(updated);
      setDirectory((d) => ({ ...d, [updated.username]: updated }));
      setShowEditProfile(false);
    } finally {
      setEditBusy(false);
    }
  };

  const fullCleanupCall = () => {
    clearInterval(callDurationRef.current);
    clearInterval(callDocPollRef.current);
    if (pcRef.current) {
      try { pcRef.current.close(); } catch {}
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setCallState("idle");
    setCallInfo(null);
    setCallDuration(0);
    setMuted(false);
    setCameraOff(false);
  };

  const logout = () => {
    clearInterval(pollRef.current);
    clearInterval(chatsPollRef.current);
    clearInterval(heartbeatRef.current);
    clearInterval(presencePollRef.current);
    clearInterval(recordTimerRef.current);
    clearInterval(incomingPollRef.current);
    clearInterval(resendTimerRef.current);
    if (recordStreamRef.current) recordStreamRef.current.getTracks().forEach((t) => t.stop());
    fullCleanupCall();
    setRecording(false);
    setUser(null);
    setActive(null);
    setMessages([]);
    setChats([]);
    setGroups([]);
    setPresence({});
    setIncomingCall(null);
    setDirectory({});
    setShowEditProfile(false);
    setAuthStep("phone");
    setDevOtp("");
    setResendIn(0);
    setAvatarDraft(null);
    setAvatarError("");
    setForm({ phone: "", otp: "", displayName: "", email: "", dob: "", description: "" });
  };

  // ---------- presence ----------
  useEffect(() => {
    if (!user) return;
    const beat = () => safeSet(`presence:${user.username}`, { ts: Date.now() });
    beat();
    heartbeatRef.current = setInterval(beat, 5000);
    return () => clearInterval(heartbeatRef.current);
  }, [user]);

  const refreshPresence = useCallback(async () => {
    if (!user) return;
    const usernames = new Set(chats);
    if (active && active.type === "direct") usernames.add(active.id);
    if (active && active.type === "group") {
      const g = groups.find((gr) => gr.id === active.id);
      if (g) g.members.forEach((m) => usernames.add(m));
    }
    const entries = {};
    for (const uname of usernames) {
      if (uname === user.username) continue;
      const p = await safeGet(`presence:${uname}`);
      entries[uname] = p ? p.ts : null;
    }
    setPresence((prev) => ({ ...prev, ...entries }));
  }, [user, chats, active, groups]);

  useEffect(() => {
    if (!user) return;
    refreshPresence();
    presencePollRef.current = setInterval(refreshPresence, 5000);
    return () => clearInterval(presencePollRef.current);
  }, [user, refreshPresence]);

  // ---------- chats + groups polling ----------
  const refreshChats = useCallback(async () => {
    if (!user) return;
    const list = (await safeGet(`chats:${user.username}`)) || [];
    setChats(list);
    const groupIds = (await safeGet(`usergroups:${user.username}`)) || [];
    const loaded = [];
    for (const gid of groupIds) {
      const g = await safeGet(`group:${gid}`);
      if (g) loaded.push(g);
    }
    setGroups(loaded);
    const allMembers = loaded.flatMap((g) => g.members);
    ensureContacts([...list, ...allMembers]);
  }, [user, ensureContacts]);

  useEffect(() => {
    if (!user) return;
    refreshChats();
    chatsPollRef.current = setInterval(refreshChats, 4000);
    return () => clearInterval(chatsPollRef.current);
  }, [user, refreshChats]);

  // ---------- messages polling ----------
  const refreshMessages = useCallback(async () => {
    if (!user || !active) return;
    const key = active.type === "group" ? `groupmsgs:${active.id}` : pairKey(user.username, active.id);
    const msgs = (await safeGet(key)) || [];
    setMessages(msgs);
  }, [user, active]);

  useEffect(() => {
    if (!active) return;
    refreshMessages();
    pollRef.current = setInterval(refreshMessages, 2500);
    return () => clearInterval(pollRef.current);
  }, [active, refreshMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, active]);

  // ---------- direct chat / groups ----------
  const addPartnerToChats = async (owner, partner) => {
    const list = (await safeGet(`chats:${owner}`)) || [];
    if (!list.includes(partner)) {
      list.unshift(partner);
      await safeSet(`chats:${owner}`, list);
    }
  };

  const openDirect = async (partner) => {
    setActive({ type: "direct", id: partner, name: getName(partner) });
    setSearchResult(null);
    setSearchName("");
    setSearchStatus("");
    await addPartnerToChats(user.username, partner);
    refreshChats();
  };

  const openGroup = (g) => setActive({ type: "group", id: g.id, name: g.name });

  const doSearch = async () => {
    const phone = normalizePhone(searchName.trim());
    setSearchResult(null);
    setSearchStatus("");
    if (!phone) return;
    if (phone === user.username) {
      setSearchStatus("That's you! :)");
      return;
    }
    const found = await safeGet(`user:${phone}`);
    if (!found) {
      setSearchStatus("No user is registered with this number.");
      return;
    }
    setSearchResult(found);
    setDirectory((d) => ({ ...d, [found.username]: found }));
  };

  const createGroup = async () => {
    setGroupError("");
    const name = groupName.trim();
    const rawMembers = groupMembersInput.split(",").map((s) => normalizePhone(s.trim())).filter(Boolean);
    if (!name) { setGroupError("Please enter a group name."); return; }
    if (rawMembers.length === 0) { setGroupError("Please enter at least one member's mobile number."); return; }
    setGroupBusy(true);
    try {
      const validMembers = [];
      for (const m of rawMembers) {
        if (m === user.username) continue;
        const found = await safeGet(`user:${m}`);
        if (found) { validMembers.push(m); setDirectory((d) => ({ ...d, [m]: found })); }
      }
      if (validMembers.length === 0) {
        setGroupError("No valid members found. Please check the numbers.");
        setGroupBusy(false);
        return;
      }
      const members = Array.from(new Set([user.username, ...validMembers]));
      const id = uid();
      const group = { id, name, members, createdBy: user.username, createdAt: Date.now() };
      await safeSet(`group:${id}`, group);
      await safeSet(`groupmsgs:${id}`, []);
      for (const m of members) {
        const gl = (await safeGet(`usergroups:${m}`)) || [];
        if (!gl.includes(id)) { gl.unshift(id); await safeSet(`usergroups:${m}`, gl); }
      }
      setShowNewGroup(false);
      setGroupName("");
      setGroupMembersInput("");
      await refreshChats();
      openGroup(group);
    } finally {
      setGroupBusy(false);
    }
  };

  // ---------- file attach ----------
  const handleFileSelect = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setFileError("");
    if (file.size > MAX_FILE_BYTES) { setFileError("File is too large. Please choose a file under 3MB."); return; }
    const reader = new FileReader();
    reader.onload = () => setPendingFile({ name: file.name, type: file.type, size: file.size, dataUrl: reader.result });
    reader.onerror = () => setFileError("Could not read the file. Please try again.");
    reader.readAsDataURL(file);
  };
  const clearPendingFile = () => setPendingFile(null);

  // ---------- voice recording ----------
  const startRecording = async () => {
    setFileError("");
    if (!navigator.mediaDevices || !window.MediaRecorder) { setFileError("This browser does not support voice recording."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > MAX_FILE_BYTES) { setFileError("Voice message is too long. Please record a shorter clip."); return; }
        const reader = new FileReader();
        reader.onload = () => setPendingFile({ name: `voice-${Date.now()}.webm`, type: blob.type || "audio/webm", size: blob.size, dataUrl: reader.result, isVoice: true });
        reader.readAsDataURL(blob);
      };
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      setFileError("Microphone permission was denied.");
    }
  };
  const stopRecording = () => {
    clearInterval(recordTimerRef.current);
    setRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
  };
  const cancelRecording = () => {
    clearInterval(recordTimerRef.current);
    setRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      audioChunksRef.current = [];
      mediaRecorderRef.current.onstop = () => { if (recordStreamRef.current) recordStreamRef.current.getTracks().forEach((t) => t.stop()); };
      mediaRecorderRef.current.stop();
    }
  };
  const fmtRecordTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ---------- send message ----------
  const sendMessage = async () => {
    const text = draft.trim();
    if (!text && !pendingFile) return;
    if (!active || !user || sending) return;
    setSending(true);
    const attachment = pendingFile
      ? { name: pendingFile.name, fileType: pendingFile.type, size: pendingFile.size, dataUrl: pendingFile.dataUrl, isVoice: !!pendingFile.isVoice }
      : null;
    setDraft("");
    setPendingFile(null);
    try {
      const key = active.type === "group" ? `groupmsgs:${active.id}` : pairKey(user.username, active.id);
      const current = (await safeGet(key)) || [];
      const newMsg = { from: user.username, text, ts: Date.now(), attachment };
      const updated = [...current, newMsg];
      const ok = await safeSet(key, updated);
      if (!ok) { setFileError("Failed to send. The file may be too large."); setSending(false); return; }
      setMessages(updated);
      if (active.type === "direct") {
        await addPartnerToChats(user.username, active.id);
        await addPartnerToChats(active.id, user.username);
      }
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  // ================= CALLING (WebRTC, signaling via storage) =================
  const waitForIceGathering = (pc) =>
    new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") { resolve(); return; }
      const timeout = setTimeout(() => { pc.removeEventListener("icegatheringstatechange", check); resolve(); }, 4000);
      const check = () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(timeout);
          pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", check);
    });

  const buildPeerConnection = (isVideo) => {
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (isVideo && remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      if (!isVideo && remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
      if (isVideo && remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
    };
    return pc;
  };

  const startCallDurationTimer = () => {
    setCallDuration(0);
    callDurationRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
  };

  const startCall = async (type) => {
    if (!active || active.type !== "direct" || !user) return;
    setCallError("");
    const isVideo = type === "video";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
      localStreamRef.current = stream;
      if (isVideo && localVideoRef.current) localVideoRef.current.srcObject = stream;
      const pc = buildPeerConnection(isVideo);
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      const callId = uid();
      const callDoc = {
        id: callId,
        caller: user.username,
        callee: active.id,
        type,
        offer: pc.localDescription,
        answer: null,
        status: "ringing",
        createdAt: Date.now(),
      };
      await safeSet(`call:${callId}`, callDoc);
      await safeSet(`incomingcall:${active.id}`, { id: callId, caller: user.username, type });

      setCallInfo({ id: callId, peer: active.id, type, isCaller: true });
      setCallState("calling");

      callDocPollRef.current = setInterval(async () => {
        const doc = await safeGet(`call:${callId}`);
        if (!doc) return;
        if (doc.status === "accepted" && doc.answer && pc.signalingState !== "stable") {
          await pc.setRemoteDescription(doc.answer);
          setCallState("in-call");
          startCallDurationTimer();
          clearInterval(callDocPollRef.current);
          callDocPollRef.current = setInterval(async () => {
            const d2 = await safeGet(`call:${callId}`);
            if (!d2 || d2.status === "ended" || d2.status === "declined") {
              hangUp(callId, false);
            }
          }, 2000);
        } else if (doc.status === "declined") {
          setCallError("The call was declined.");
          hangUp(callId, false);
        }
      }, 1500);
    } catch (err) {
      setCallError("Camera/microphone permission was denied.");
      fullCleanupCall();
    }
  };

  // poll for incoming calls
  useEffect(() => {
    if (!user) return;
    incomingPollRef.current = setInterval(async () => {
      if (callState !== "idle") return;
      const inc = await safeGet(`incomingcall:${user.username}`);
      if (inc && inc.id && !handledIncomingRef.current.has(inc.id)) {
        const doc = await safeGet(`call:${inc.id}`);
        if (doc && doc.status === "ringing") {
          ensureContacts([inc.caller]);
          setIncomingCall({ id: inc.id, caller: inc.caller, type: inc.type });
        }
      }
    }, 1500);
    return () => clearInterval(incomingPollRef.current);
  }, [user, callState]);

  const acceptCall = async () => {
    if (!incomingCall) return;
    const { id, caller, type } = incomingCall;
    handledIncomingRef.current.add(id);
    setIncomingCall(null);
    setCallError("");
    const isVideo = type === "video";
    try {
      const doc = await safeGet(`call:${id}`);
      if (!doc) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
      localStreamRef.current = stream;
      if (isVideo && localVideoRef.current) localVideoRef.current.srcObject = stream;
      const pc = buildPeerConnection(isVideo);
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      await pc.setRemoteDescription(doc.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc);

      await safeSet(`call:${id}`, { ...doc, answer: pc.localDescription, status: "accepted" });
      await safeDelete(`incomingcall:${user.username}`);

      setCallInfo({ id, peer: caller, type, isCaller: false });
      setCallState("in-call");
      startCallDurationTimer();

      callDocPollRef.current = setInterval(async () => {
        const d2 = await safeGet(`call:${id}`);
        if (!d2 || d2.status === "ended") hangUp(id, false);
      }, 2000);
    } catch {
      setCallError("Camera/microphone permission was denied.");
      fullCleanupCall();
    }
  };

  const declineCall = async () => {
    if (!incomingCall) return;
    const { id } = incomingCall;
    handledIncomingRef.current.add(id);
    const doc = await safeGet(`call:${id}`);
    if (doc) await safeSet(`call:${id}`, { ...doc, status: "declined" });
    await safeDelete(`incomingcall:${user.username}`);
    setIncomingCall(null);
  };

  const hangUp = async (callId, notify = true) => {
    const id = callId || (callInfo && callInfo.id);
    if (notify && id) {
      const doc = await safeGet(`call:${id}`);
      if (doc) await safeSet(`call:${id}`, { ...doc, status: "ended" });
    }
    fullCleanupCall();
  };

  const toggleMute = () => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = muted));
    setMuted((m) => !m);
  };
  const toggleCamera = () => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = cameraOff));
    setCameraOff((c) => !c);
  };

  const fmtCallDuration = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ================= STYLES: WhatsApp-inspired green theme =================
  const C = {
    bgOuter: "#0B141A",
    sidebarBg: "#111B21",
    panelBg: "#202C33",
    headerBg: "#202C33",
    chatBg: "#0B141A",
    bubbleMine: "#005C4B",
    bubbleTheirs: "#202C33",
    accent: "#00A884",
    accentDark: "#008069",
    text: "#E9EDEF",
    subtext: "#8696A0",
    border: "rgba(255,255,255,0.08)",
    danger: "#F15C4F",
  };

  const inputStyle = {
    width: "100%",
    padding: "11px 13px",
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: "#2A3942",
    color: C.text,
    fontSize: 14,
    marginBottom: 10,
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };

  const pageStyle = {
    minHeight: "100vh",
    background: C.bgOuter,
    fontFamily: "'Segoe UI', 'Inter', system-ui, sans-serif",
    color: C.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  };

  if (booting) {
    return (
      <div style={pageStyle}>
        <Loader2 className="animate-spin" size={28} color={C.accent} />
      </div>
    );
  }

  // ---------- AUTH SCREEN (phone + OTP, WhatsApp style) ----------
  if (!user) {
    return (
      <div style={pageStyle}>
        <div style={{ width: "100%", maxWidth: 380, background: C.panelBg, borderRadius: 20, padding: 32, boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: `1px solid ${C.border}` }}>
          <div style={{ textAlign: "center", marginBottom: 26 }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: `linear-gradient(135deg,${C.accent},${C.accentDark})`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <MessageCircle size={26} color="#0B141A" />
            </div>
            <h1 style={{ fontFamily: "'Georgia', serif", fontSize: 30, margin: 0, letterSpacing: 0.5, color: C.text }}>
              گفتگو <span style={{ opacity: 0.6, fontSize: 18, fontFamily: "Inter" }}>Guftgu</span>
            </h1>
            <p style={{ color: C.subtext, fontSize: 13, marginTop: 6 }}>Your conversations, your people.</p>
          </div>

          {/* ---- Step 1: phone number ---- */}
          {authStep === "phone" && (
            <>
              <p style={{ fontSize: 13, color: C.text, marginBottom: 4, fontWeight: 600 }}>Enter your mobile number</p>
              <p style={{ fontSize: 12, color: C.subtext, marginBottom: 14 }}>We'll send a verification code (OTP) to this number.</p>
              <input
                placeholder="+92 300 1234567"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                style={{ ...inputStyle, marginBottom: 6, fontSize: 16, letterSpacing: 0.5 }}
              />
              {authError && <p style={{ color: C.danger, fontSize: 12.5, margin: "6px 2px 10px" }}>{authError}</p>}
              <button onClick={sendOtp} disabled={busy} style={{ width: "100%", marginTop: 12, padding: "12px 0", borderRadius: 10, border: "none", background: C.accent, color: "#0B141A", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: busy ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                {busy ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />} Send Code
              </button>
            </>
          )}

          {/* ---- Step 2: OTP verification ---- */}
          {authStep === "otp" && (
            <>
              <button onClick={changeNumber} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: C.subtext, cursor: "pointer", fontSize: 12.5, marginBottom: 14, padding: 0 }}>
                <ArrowLeft size={14} /> Change number
              </button>
              <p style={{ fontSize: 13, color: C.text, marginBottom: 4, fontWeight: 600 }}>Enter verification code</p>
              <p style={{ fontSize: 12, color: C.subtext, marginBottom: 14 }}>
                A 6-digit code has been sent to <b style={{ color: C.text }}>{form.phone}</b>.
              </p>
              <input
                placeholder="• • • • • •"
                value={form.otp}
                inputMode="numeric"
                maxLength={6}
                onChange={(e) => setForm({ ...form, otp: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
                style={{ ...inputStyle, marginBottom: 6, fontSize: 22, letterSpacing: 10, textAlign: "center" }}
              />
              {devOtp && (
                <p style={{ fontSize: 12, color: C.accent, margin: "2px 2px 10px", textAlign: "center" }}>
                  Demo mode — your code is: <b>{devOtp}</b> (no live SMS gateway is connected)
                </p>
              )}
              {authError && <p style={{ color: C.danger, fontSize: 12.5, margin: "6px 2px 10px" }}>{authError}</p>}
              <button onClick={verifyOtp} disabled={busy} style={{ width: "100%", marginTop: 6, padding: "12px 0", borderRadius: 10, border: "none", background: C.accent, color: "#0B141A", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: busy ? 0.7 : 1 }}>
                {busy ? "..." : "Verify"}
              </button>
              <button onClick={resendOtp} disabled={resendIn > 0 || busy} style={{ width: "100%", marginTop: 10, padding: "9px 0", borderRadius: 10, border: "none", background: "transparent", color: resendIn > 0 ? C.subtext : C.accent, fontWeight: 600, fontSize: 12.5, cursor: resendIn > 0 ? "default" : "pointer" }}>
                {resendIn > 0 ? `Resend code (${resendIn}s)` : "Resend code"}
              </button>
            </>
          )}

          {/* ---- Step 3: profile setup (first-time users) ---- */}
          {authStep === "profile" && (
            <>
              <p style={{ fontSize: 13, color: C.text, marginBottom: 4, fontWeight: 600 }}>Set up your profile</p>
              <p style={{ fontSize: 12, color: C.subtext, marginBottom: 16 }}>You can update these details anytime later.</p>

              <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
                <div style={{ position: "relative" }}>
                  <div style={{ width: 76, height: 76, borderRadius: "50%", background: "#2A3942", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", border: `2px solid ${C.accent}55` }}>
                    {avatarDraft ? (
                      <img src={avatarDraft} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <CircleUserRound size={34} color={C.accent} />
                    )}
                  </div>
                  <input ref={avatarInputRef} type="file" accept="image/*" onChange={(e) => handleAvatarSelect(e, "new")} style={{ display: "none" }} />
                  <button onClick={() => avatarInputRef.current && avatarInputRef.current.click()} title="Add profile picture" style={{ position: "absolute", bottom: -2, right: -2, width: 28, height: 28, borderRadius: "50%", border: `2px solid ${C.panelBg}`, background: C.accent, color: "#0B141A", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Camera size={13} />
                  </button>
                </div>
              </div>
              {avatarError && <p style={{ color: C.danger, fontSize: 12, textAlign: "center", marginTop: -10, marginBottom: 10 }}>{avatarError}</p>}

              <input placeholder="Your name (e.g. Ali Khan)" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} style={inputStyle} />
              <div style={{ position: "relative" }}>
                <Mail size={15} color={C.subtext} style={{ position: "absolute", left: 12, top: 13 }} />
                <input placeholder="Gmail / email address" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ ...inputStyle, paddingLeft: 34 }} />
              </div>
              <div style={{ position: "relative" }}>
                <Calendar size={15} color={C.subtext} style={{ position: "absolute", left: 12, top: 13, pointerEvents: "none" }} />
                <input placeholder="Date of birth" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} style={{ ...inputStyle, paddingLeft: 34, colorScheme: "dark" }} />
              </div>
              <textarea placeholder="About / status (e.g. Busy, leave a message)" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...inputStyle, resize: "none", fontFamily: "inherit", marginBottom: 6 }} />

              {authError && <p style={{ color: C.danger, fontSize: 12.5, margin: "6px 2px 10px" }}>{authError}</p>}

              <button onClick={submitProfile} disabled={busy} style={{ width: "100%", marginTop: 10, padding: "12px 0", borderRadius: 10, border: "none", background: C.accent, color: "#0B141A", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: busy ? 0.7 : 1 }}>
                {busy ? "..." : "Start chatting"}
              </button>
            </>
          )}

          <p style={{ fontSize: 11, color: C.subtext, marginTop: 18, textAlign: "center" }}>
            Note: this is demo storage, so OTPs aren't sent through a real SMS gateway — the code is shown directly on this screen instead. Please don't save sensitive information here.
          </p>
        </div>
      </div>
    );
  }

  const activeGroup = active && active.type === "group" ? groups.find((g) => g.id === active.id) : null;

  return (
    <div style={{ ...pageStyle, alignItems: "stretch" }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } } @keyframes ringPulse { 0% { box-shadow: 0 0 0 0 rgba(0,168,132,0.6); } 70% { box-shadow: 0 0 0 18px rgba(0,168,132,0); } 100% { box-shadow: 0 0 0 0 rgba(0,168,132,0); } }`}</style>

      <div style={{ width: "100%", maxWidth: 960, height: "min(88vh, 720px)", margin: "auto", background: C.sidebarBg, borderRadius: 12, overflow: "hidden", display: "flex", boxShadow: "0 20px 60px rgba(0,0,0,0.45)", border: `1px solid ${C.border}`, position: "relative" }}>

        {/* Sidebar */}
        <div style={{ width: 300, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", background: C.sidebarBg }}>
          <div style={{ padding: "16px 18px", background: C.panelBg, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <button onClick={openEditProfile} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#2A3942", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                  {user.avatar ? <img src={user.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <CircleUserRound size={22} color={C.accent} />}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{user.displayName}</span>
                    <Pencil size={11} color={C.subtext} />
                  </div>
                  <div style={{ fontSize: 11, color: C.subtext }}>{user.username}</div>
                </div>
              </button>
              <button onClick={logout} title="Logout" style={{ background: "none", border: "none", cursor: "pointer", color: C.subtext }}>
                <LogOut size={18} />
              </button>
            </div>
          </div>

          <div style={{ padding: 14, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input placeholder="Search by mobile number..." value={searchName} onChange={(e) => setSearchName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} style={{ ...inputStyle, margin: 0, flex: 1, fontSize: 13, padding: "9px 10px" }} />
              <button onClick={doSearch} style={{ border: "none", borderRadius: 8, background: "#2A3942", color: C.accent, padding: "0 12px", cursor: "pointer" }}>
                <Search size={16} />
              </button>
            </div>
            {searchStatus && <p style={{ fontSize: 12, color: C.danger, marginTop: 6 }}>{searchStatus}</p>}
            {searchResult && (
              <button onClick={() => openDirect(searchResult.username)} style={{ marginTop: 8, width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, border: `1px dashed ${C.accent}66`, background: "transparent", color: C.text, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#2A3942", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, fontSize: 11, fontWeight: 700, color: C.accent }}>
                  {searchResult.avatar ? <img src={searchResult.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : searchResult.displayName.slice(0, 2).toUpperCase()}
                </div>
                <span>💬 Start chat with {searchResult.displayName} ({searchResult.username})</span>
              </button>
            )}
            <button onClick={() => setShowNewGroup(true)} style={{ marginTop: 10, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 0", borderRadius: 8, border: `1px solid ${C.accent}66`, background: "transparent", color: C.accent, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> Create new group
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {groups.length === 0 && chats.length === 0 && (
              <p style={{ padding: 18, fontSize: 13, color: C.subtext }}>No chats yet. Search above to start a conversation or create a group.</p>
            )}

            {groups.length > 0 && <div style={{ padding: "10px 18px 4px", fontSize: 11, color: C.subtext, textTransform: "uppercase", letterSpacing: 0.5 }}>Groups</div>}
            {groups.map((g) => (
              <button key={g.id} onClick={() => openGroup(g)} style={{ width: "100%", textAlign: "left", padding: "13px 18px", border: "none", borderBottom: "1px solid rgba(255,255,255,0.03)", background: active && active.type === "group" && active.id === g.id ? C.panelBg : "transparent", color: C.text, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "#2A3942", display: "flex", alignItems: "center", justifyContent: "center", color: C.accent, flexShrink: 0 }}>
                  <Users size={16} />
                </div>
                <div>
                  <div style={{ fontSize: 14 }}>{g.name}</div>
                  <div style={{ fontSize: 11, color: C.subtext }}>{g.members.length} members</div>
                </div>
              </button>
            ))}

            {chats.length > 0 && <div style={{ padding: "12px 18px 4px", fontSize: 11, color: C.subtext, textTransform: "uppercase", letterSpacing: 0.5 }}>Direct Messages</div>}
            {chats.map((partner) => (
              <button key={partner} onClick={() => openDirect(partner)} style={{ width: "100%", textAlign: "left", padding: "13px 18px", border: "none", borderBottom: "1px solid rgba(255,255,255,0.03)", background: active && active.type === "direct" && active.id === partner ? C.panelBg : "transparent", color: C.text, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#2A3942", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontSize: 13, fontWeight: 700, color: C.accent }}>
                    {getAvatar(partner) ? <img src={getAvatar(partner)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initialsFor(partner)}
                  </div>
                  {isOnline(presence[partner]) && <span style={{ position: "absolute", bottom: -1, right: -1, width: 10, height: 10, borderRadius: "50%", background: C.accent, border: `2px solid ${C.sidebarBg}` }} />}
                </div>
                <div>
                  <div style={{ fontSize: 14 }}>{getName(partner)}</div>
                  <div style={{ fontSize: 11, color: C.subtext }}>{partner}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Chat window */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.chatBg }}>
          {!active ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: C.subtext, gap: 10 }}>
              <MessageCircle size={40} />
              <p>Search for someone on the left or create a group to start chatting</p>
            </div>
          ) : (
            <>
              <div style={{ padding: "14px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, background: C.headerBg }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <div style={{ width: 36, height: 36, borderRadius: active.type === "group" ? 10 : "50%", background: "#2A3942", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontWeight: 700, color: C.accent }}>
                    {active.type === "group" ? <Users size={17} /> : getAvatar(active.id) ? <img src={getAvatar(active.id)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initialsFor(active.id)}
                  </div>
                  {active.type === "direct" && isOnline(presence[active.id]) && <span style={{ position: "absolute", bottom: -1, right: -1, width: 10, height: 10, borderRadius: "50%", background: C.accent, border: `2px solid ${C.headerBg}` }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{active.type === "group" ? active.name : getName(active.id)}</div>
                  {active.type === "group" ? (
                    <div style={{ fontSize: 11, color: C.subtext }}>{(activeGroup || { members: [] }).members.map((m) => getName(m)).join(", ")}</div>
                  ) : (
                    <div style={{ fontSize: 11.5, color: isOnline(presence[active.id]) ? C.accent : C.subtext }}>
                      {isOnline(presence[active.id]) ? "Online" : presence[active.id] ? `Last seen ${formatLastSeen(presence[active.id])}` : "Offline"} · {active.id}
                    </div>
                  )}
                </div>
                {active.type === "direct" && callState === "idle" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => startCall("audio")} title="Voice call" style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: "#2A3942", color: C.accent, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Phone size={16} />
                    </button>
                    <button onClick={() => startCall("video")} title="Video call" style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: "#2A3942", color: C.accent, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Video size={17} />
                    </button>
                  </div>
                )}
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                {messages.map((m, i) => {
                  const mine = m.from === user.username;
                  return (
                    <div key={i} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "70%", background: mine ? C.bubbleMine : C.bubbleTheirs, color: C.text, padding: "9px 13px", borderRadius: mine ? "10px 10px 2px 10px" : "10px 10px 10px 2px", fontSize: 14, lineHeight: 1.4 }}>
                      {active.type === "group" && !mine && <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, marginBottom: 2 }}>{getName(m.from)}</div>}
                      {m.attachment && m.attachment.fileType && m.attachment.fileType.startsWith("image/") ? (
                        <img src={m.attachment.dataUrl} alt={m.attachment.name} style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 10, display: "block", marginBottom: m.text ? 6 : 2 }} />
                      ) : m.attachment && (m.attachment.isVoice || (m.attachment.fileType && m.attachment.fileType.startsWith("audio/"))) ? (
                        <audio controls src={m.attachment.dataUrl} style={{ maxWidth: 220, height: 34, marginBottom: m.text ? 6 : 2 }} />
                      ) : m.attachment ? (
                        <a href={m.attachment.dataUrl} download={m.attachment.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.08)", color: "inherit", textDecoration: "none", marginBottom: m.text ? 6 : 2 }}>
                          <FileText size={16} />
                          <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.attachment.name}</span>
                          <Download size={14} style={{ marginLeft: "auto", flexShrink: 0 }} />
                        </a>
                      ) : null}
                      {m.text && <div>{m.text}</div>}
                      <div style={{ fontSize: 10, opacity: 0.65, marginTop: 3, textAlign: "right" }}>{fmtTime(m.ts)}</div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, background: C.headerBg }}>
                {fileError && <p style={{ color: C.danger, fontSize: 12, margin: "0 16px 6px" }}>{fileError}</p>}
                {callError && <p style={{ color: C.danger, fontSize: 12, margin: "0 16px 6px" }}>{callError}</p>}
                {pendingFile && (
                  <div style={{ margin: "0 16px 8px", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: C.bgOuter, border: `1px solid ${C.accent}55` }}>
                    {pendingFile.isVoice ? (
                      <><Mic size={18} color={C.accent} /><audio controls src={pendingFile.dataUrl} style={{ height: 30, flex: 1 }} /></>
                    ) : pendingFile.type.startsWith("image/") ? (
                      <><img src={pendingFile.dataUrl} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover" }} /><span style={{ fontSize: 12.5, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{pendingFile.name}</span></>
                    ) : (
                      <><FileText size={18} color={C.accent} /><span style={{ fontSize: 12.5, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{pendingFile.name}</span></>
                    )}
                    <button onClick={clearPendingFile} style={{ background: "none", border: "none", color: C.subtext, cursor: "pointer" }}><X size={15} /></button>
                  </div>
                )}
                {recording && (
                  <div style={{ margin: "0 16px 8px", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: "rgba(241,92,79,0.12)", border: `1px solid ${C.danger}55` }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.danger, animation: "pulse 1.2s infinite" }} />
                    <span style={{ fontSize: 13, color: C.text, flex: 1 }}>Recording... {fmtRecordTime(recordSeconds)}</span>
                    <button onClick={cancelRecording} style={{ background: "none", border: "none", color: C.subtext, cursor: "pointer", fontSize: 12 }}>Cancel</button>
                  </div>
                )}
                <div style={{ padding: "0 16px 16px", display: "flex", gap: 10 }}>
                  <input ref={fileInputRef} type="file" onChange={handleFileSelect} style={{ display: "none" }} />
                  <button onClick={() => fileInputRef.current && fileInputRef.current.click()} title="Attach file" style={{ width: 44, height: 44, borderRadius: 12, border: `1px solid ${C.accent}55`, background: "transparent", color: C.accent, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Paperclip size={18} />
                  </button>
                  <button onClick={recording ? stopRecording : startRecording} title={recording ? "Recording rokein" : "Voice message"} style={{ width: 44, height: 44, borderRadius: 12, border: recording ? "none" : `1px solid ${C.accent}55`, background: recording ? C.danger : "transparent", color: recording ? "#0B141A" : C.accent, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {recording ? <Square size={16} /> : <Mic size={18} />}
                  </button>
                  <textarea rows={1} placeholder="Type a message..." value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} style={{ flex: 1, resize: "none", borderRadius: 12, border: `1px solid ${C.border}`, background: "#2A3942", color: C.text, padding: "11px 14px", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
                  <button onClick={sendMessage} disabled={sending} style={{ width: 44, height: 44, borderRadius: 12, border: "none", background: C.accent, color: "#0B141A", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: sending ? 0.6 : 1 }}>
                    <Send size={18} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* New Group Modal */}
        {showNewGroup && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
            <div style={{ width: 340, background: C.panelBg, borderRadius: 16, padding: 24, border: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>New Group</h3>
                <button onClick={() => { setShowNewGroup(false); setGroupError(""); }} style={{ background: "none", border: "none", color: C.subtext, cursor: "pointer" }}><X size={18} /></button>
              </div>
              <input placeholder="Group name" value={groupName} onChange={(e) => setGroupName(e.target.value)} style={inputStyle} />
              <input placeholder="Members' mobile numbers (comma-separated)" value={groupMembersInput} onChange={(e) => setGroupMembersInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createGroup()} style={{ ...inputStyle, marginBottom: 6 }} />
              {groupError && <p style={{ color: C.danger, fontSize: 12.5, margin: "6px 2px 10px" }}>{groupError}</p>}
              <button onClick={createGroup} disabled={groupBusy} style={{ width: "100%", marginTop: 10, padding: "11px 0", borderRadius: 10, border: "none", background: C.accent, color: "#0B141A", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: groupBusy ? 0.7 : 1 }}>
                {groupBusy ? "..." : "Create Group"}
              </button>
            </div>
          </div>
        )}

        {/* Edit Profile modal */}
        {showEditProfile && editForm && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
            <div style={{ width: 360, maxHeight: "85%", overflowY: "auto", background: C.panelBg, borderRadius: 16, padding: 24, border: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>Edit Profile</h3>
                <button onClick={() => setShowEditProfile(false)} style={{ background: "none", border: "none", color: C.subtext, cursor: "pointer" }}><X size={18} /></button>
              </div>

              <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
                <div style={{ position: "relative" }}>
                  <div style={{ width: 76, height: 76, borderRadius: "50%", background: "#2A3942", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", border: `2px solid ${C.accent}55` }}>
                    {editForm.avatar ? <img src={editForm.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <CircleUserRound size={34} color={C.accent} />}
                  </div>
                  <input ref={editAvatarInputRef} type="file" accept="image/*" onChange={(e) => handleAvatarSelect(e, "edit")} style={{ display: "none" }} />
                  <button onClick={() => editAvatarInputRef.current && editAvatarInputRef.current.click()} title="Change profile picture" style={{ position: "absolute", bottom: -2, right: -2, width: 28, height: 28, borderRadius: "50%", border: `2px solid ${C.panelBg}`, background: C.accent, color: "#0B141A", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Camera size={13} />
                  </button>
                </div>
              </div>
              {avatarError && <p style={{ color: C.danger, fontSize: 12, textAlign: "center", marginTop: -10, marginBottom: 10 }}>{avatarError}</p>}

              <p style={{ fontSize: 11, color: C.subtext, margin: "0 2px 12px", textAlign: "center" }}>{user.username}</p>

              <input placeholder="Name" value={editForm.displayName} onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })} style={inputStyle} />
              <div style={{ position: "relative" }}>
                <Mail size={15} color={C.subtext} style={{ position: "absolute", left: 12, top: 13 }} />
                <input placeholder="Gmail / email address" type="email" value={editForm.email || ""} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} style={{ ...inputStyle, paddingLeft: 34 }} />
              </div>
              <div style={{ position: "relative" }}>
                <Calendar size={15} color={C.subtext} style={{ position: "absolute", left: 12, top: 13, pointerEvents: "none" }} />
                <input placeholder="Date of birth" type="date" value={editForm.dob || ""} onChange={(e) => setEditForm({ ...editForm, dob: e.target.value })} style={{ ...inputStyle, paddingLeft: 34, colorScheme: "dark" }} />
              </div>
              <textarea placeholder="About / description" rows={2} value={editForm.description || ""} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} style={{ ...inputStyle, resize: "none", fontFamily: "inherit", marginBottom: 6 }} />

              {editError && <p style={{ color: C.danger, fontSize: 12.5, margin: "6px 2px 10px" }}>{editError}</p>}

              <button onClick={saveEditProfile} disabled={editBusy} style={{ width: "100%", marginTop: 10, padding: "11px 0", borderRadius: 10, border: "none", background: C.accent, color: "#0B141A", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: editBusy ? 0.7 : 1 }}>
                {editBusy ? "..." : "Save Changes"}
              </button>
            </div>
          </div>
        )}

        {/* Incoming call modal */}
        {incomingCall && callState === "idle" && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }}>
            <div style={{ width: 300, background: C.panelBg, borderRadius: 20, padding: 32, textAlign: "center", border: `1px solid ${C.border}` }}>
              <div style={{ width: 84, height: 84, borderRadius: "50%", background: "#2A3942", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", margin: "0 auto 16px", fontSize: 26, fontWeight: 700, color: C.accent, animation: "ringPulse 1.6s infinite" }}>
                {getAvatar(incomingCall.caller) ? <img src={getAvatar(incomingCall.caller)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initialsFor(incomingCall.caller)}
              </div>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>{getName(incomingCall.caller)}</div>
              <div style={{ color: C.subtext, fontSize: 13, marginBottom: 26 }}>
                Incoming {incomingCall.type === "video" ? "video" : "voice"} call...
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 24 }}>
                <button onClick={declineCall} style={{ width: 54, height: 54, borderRadius: "50%", border: "none", background: C.danger, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <PhoneOff size={22} />
                </button>
                <button onClick={acceptCall} style={{ width: 54, height: 54, borderRadius: "50%", border: "none", background: C.accent, color: "#0B141A", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Phone size={22} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Active / outgoing call overlay */}
        {(callState === "calling" || callState === "in-call") && callInfo && (
          <div style={{ position: "absolute", inset: 0, background: "#0B141A", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 30 }}>
            {callInfo.type === "video" ? (
              <div style={{ position: "relative", width: "100%", height: "100%" }}>
                <video ref={remoteVideoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000" }} />
                <video ref={localVideoRef} autoPlay playsInline muted style={{ position: "absolute", bottom: 100, right: 24, width: 130, height: 170, objectFit: "cover", borderRadius: 12, border: `2px solid ${C.accent}`, background: "#000" }} />
                <audio ref={remoteAudioRef} autoPlay />
                <div style={{ position: "absolute", top: 24, left: 0, right: 0, textAlign: "center", color: "#fff" }}>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{getName(callInfo.peer)}</div>
                  <div style={{ fontSize: 13, color: "#cfe" }}>{callState === "calling" ? "Ringing..." : fmtCallDuration(callDuration)}</div>
                </div>
              </div>
            ) : (
              <>
                <audio ref={remoteAudioRef} autoPlay />
                <div style={{ width: 100, height: 100, borderRadius: "50%", background: "#2A3942", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontSize: 32, fontWeight: 700, color: C.accent, marginBottom: 20, animation: callState === "calling" ? "ringPulse 1.6s infinite" : "none" }}>
                  {getAvatar(callInfo.peer) ? <img src={getAvatar(callInfo.peer)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initialsFor(callInfo.peer)}
                </div>
                <div style={{ fontWeight: 700, fontSize: 20, color: "#fff", marginBottom: 6 }}>{getName(callInfo.peer)}</div>
                <div style={{ color: C.subtext, fontSize: 14 }}>{callState === "calling" ? "Ringing..." : fmtCallDuration(callDuration)}</div>
              </>
            )}

            <div style={{ position: "absolute", bottom: 40, display: "flex", gap: 20 }}>
              {callState === "in-call" && (
                <>
                  <button onClick={toggleMute} style={{ width: 50, height: 50, borderRadius: "50%", border: "none", background: muted ? C.accent : "#2A3942", color: muted ? "#0B141A" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {muted ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                  {callInfo.type === "video" && (
                    <button onClick={toggleCamera} style={{ width: 50, height: 50, borderRadius: "50%", border: "none", background: cameraOff ? C.accent : "#2A3942", color: cameraOff ? "#0B141A" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
                    </button>
                  )}
                </>
              )}
              <button onClick={() => hangUp()} style={{ width: 54, height: 54, borderRadius: "50%", border: "none", background: C.danger, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <PhoneOff size={22} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
