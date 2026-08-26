"use client"

import {
  Client,
  type IMessage,
  type StompSubscription,
} from "@stomp/stompjs"

import {
  Check,
  Copy,
  Link2,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  PhoneOff,
  Pin,
  PinOff,
  Send,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
  X,
} from "lucide-react"

import Link from "next/link"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

/* =========================================================
   TYPES
   ========================================================= */

type Participant = {
  id: string
  name: string
  stream?: MediaStream
  muted?: boolean
  cameraOff?: boolean
}

type ChatMessage = {
  id: string
  participantId: string
  name: string
  text: string
  time: string
}

type RoomParticipant = {
  participantId?: string
  id?: string
  name?: string
}

type Signal = {
  type?: string
  event?: string
  roomId?: string
  participantId?: string
  targetParticipantId?: string
  name?: string
  offer?: RTCSessionDescriptionInit
  answer?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
  message?: string
  text?: string
  participants?: RoomParticipant[]
  data?: {
    type?: string
    event?: string
    roomId?: string
    participantId?: string
    targetParticipantId?: string
    name?: string
    offer?: RTCSessionDescriptionInit
    answer?: RTCSessionDescriptionInit
    candidate?: RTCIceCandidateInit
    message?: string
    text?: string
    participants?: RoomParticipant[]
  }
}

type PeerState = {
  makingOffer: boolean
  ignoreOffer: boolean
}

type JoinPhase =
  | "idle"
  | "requesting_media"
  | "connecting_ws"
  | "subscribing"
  | "joining_room"
  | "waiting_room_state"
  | "ready"
  | "error"

/* =========================================================
   CONSTANTS & HELPERS
   ========================================================= */

const colors = [
  "bg-stone-800",
  "bg-slate-800",
  "bg-zinc-800",
  "bg-neutral-800",
  "bg-gray-800",
]

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

const getBackendWsUrl = () =>
  process.env.NEXT_PUBLIC_BACKEND_WS_URL || "ws://localhost:8080/ws"

/* =========================================================
   COMPONENT
   ========================================================= */

export default function MeetingRoom({ roomId }: { roomId: string }) {
  /* =======================================================
     STATE
     ======================================================= */

  const [name, setName] = useState("")
  const [joined, setJoined] = useState(false)
  const [joinPhase, setJoinPhase] = useState<JoinPhase>("idle")
  const [slowServerNotice, setSlowServerNotice] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)

  const [participants, setParticipants] = useState<Participant[]>([])
  const [pinnedParticipantId, setPinnedParticipantId] = useState<string | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [chatOpen, setChatOpen] = useState(false)

  const [micOn, setMicOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)

  const [status, setStatus] = useState<"connecting" | "connected" | "offline">("connecting")
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [mediaWarning, setMediaWarning] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)

  /* =======================================================
     REFS
     ======================================================= */

  const clientRef = useRef<Client | null>(null)
  const subscriptionsRef = useRef<StompSubscription[]>([])
  const localStreamRef = useRef<MediaStream | null>(null)
  const localVideoElementRef = useRef<HTMLVideoElement | null>(null)

  const participantIdRef = useRef<string>("")
  const nameRef = useRef<string>("Guest")

  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const peerStatesRef = useRef<Map<string, PeerState>>(new Map())
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())

  const leavingRef = useRef(false)
  const joiningRef = useRef(false)
  const mountedRef = useRef(true)
  const slowNoticeTimerRef = useRef<NodeJS.Timeout | null>(null)

  /* =======================================================
     INITIALIZE PARTICIPANT
     ======================================================= */

  useEffect(() => {
    if (!participantIdRef.current) {
      participantIdRef.current = crypto.randomUUID()
    }

    const storedName = sessionStorage.getItem("mymeet-name")
    if (storedName) {
      nameRef.current = storedName
      setName(storedName)
    }

    return () => {
      mountedRef.current = false
      if (slowNoticeTimerRef.current) clearTimeout(slowNoticeTimerRef.current)
    }
  }, [])

  /* =======================================================
     CALLBACK REF FOR LOCAL VIDEO
     ======================================================= */

  const setLocalVideoRef = useCallback((element: HTMLVideoElement | null) => {
    localVideoElementRef.current = element
    if (element && localStreamRef.current) {
      element.srcObject = localStreamRef.current
      void element.play().catch(() => {})
    }
  }, [])

  /* =======================================================
     PUBLISH
     ======================================================= */

  const publish = useCallback((destination: string, body: unknown) => {
    const client = clientRef.current
    if (!client || !client.connected) {
      console.warn("[MyMeet] Cannot publish. STOMP is not connected.", destination)
      return false
    }

    client.publish({
      destination,
      body: JSON.stringify(body),
    })

    return true
  }, [])

  /* =======================================================
     LOCAL MEDIA
     ======================================================= */

  const getLocalMedia = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current) {
      return localStreamRef.current
    }

    setMediaError(null)
    setMediaWarning(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      })

      localStreamRef.current = stream
      setMicOn(stream.getAudioTracks().some((track) => track.enabled))
      setCameraOn(stream.getVideoTracks().some((track) => track.enabled))

      return stream
    } catch (error) {
      console.error("[MyMeet] Media error:", error)

      if (error instanceof DOMException && error.name === "NotReadableError") {
        setMediaError("Camera or microphone could not be started. Another app may be using it.")
      } else if (error instanceof DOMException && error.name === "NotAllowedError") {
        setMediaError("Camera or microphone permission was denied.")
      } else if (error instanceof DOMException && error.name === "NotFoundError") {
        setMediaError("No camera or microphone was found.")
      } else {
        setMediaError("Unable to access camera or microphone.")
      }

      return null
    }
  }, [])

  /* =======================================================
     REMOTE STREAM
     ======================================================= */

  const setRemoteStream = useCallback((participantId: string, stream: MediaStream) => {
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === participantId
          ? { ...participant, stream }
          : participant
      )
    )

    const video = remoteVideoRefs.current.get(participantId)
    if (video) {
      if (video.srcObject !== stream) {
        video.srcObject = stream
      }
      void video.play().catch(() => {})
    }
  }, [])

  /* =======================================================
     CLOSE PEER
     ======================================================= */

  const closePeer = useCallback((participantId: string) => {
    const peer = peerConnectionsRef.current.get(participantId)

    if (peer) {
      peer.ontrack = null
      peer.onicecandidate = null
      peer.onconnectionstatechange = null
      peer.oniceconnectionstatechange = null
      peer.onsignalingstatechange = null
      peer.onnegotiationneeded = null

      try {
        peer.close()
      } catch {
        // Already closed.
      }
    }

    peerConnectionsRef.current.delete(participantId)
    peerStatesRef.current.delete(participantId)
    pendingIceCandidatesRef.current.delete(participantId)

    const video = remoteVideoRefs.current.get(participantId)
    if (video) {
      video.srcObject = null
    }

    remoteVideoRefs.current.delete(participantId)
  }, [])

  /* =======================================================
     CREATE PEER
     ======================================================= */

  const createPeer = useCallback(
    (remoteParticipantId: string): RTCPeerConnection => {
      const existing = peerConnectionsRef.current.get(remoteParticipantId)
      if (existing) {
        return existing
      }

      const peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      })

      peerStatesRef.current.set(remoteParticipantId, {
        makingOffer: false,
        ignoreOffer: false,
      })

      const localStream = localStreamRef.current
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          peer.addTrack(track, localStream)
        })
      }

      peer.ontrack = (event) => {
        const remoteStream = event.streams[0]
        if (remoteStream) {
          setRemoteStream(remoteParticipantId, remoteStream)
        }
      }

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          publish("/app/webrtc/ice", {
            roomId,
            participantId: participantIdRef.current,
            targetParticipantId: remoteParticipantId,
            candidate: event.candidate.toJSON(),
          })
        }
      }

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed") {
          setTimeout(() => {
            const current = peerConnectionsRef.current.get(remoteParticipantId)
            if (current === peer && peer.connectionState === "failed") {
              closePeer(remoteParticipantId)
            }
          }, 2000)
        }

        if (peer.connectionState === "closed") {
          closePeer(remoteParticipantId)
        }
      }

      peerConnectionsRef.current.set(remoteParticipantId, peer)
      return peer
    },
    [closePeer, publish, roomId, setRemoteStream]
  )

  /* =======================================================
     NORMALIZE PARTICIPANTS
     ======================================================= */

  const normalizeParticipants = useCallback((input: RoomParticipant[]): Participant[] => {
    return input
      .map((participant) => {
        const id = participant.participantId || participant.id
        if (!id) return null
        return {
          id,
          name: participant.name || "Guest",
        }
      })
      .filter((participant): participant is Participant => participant !== null)
  }, [])

  /* =======================================================
     APPLY PENDING ICE
     ======================================================= */

  const applyPendingIce = useCallback(async (participantId: string, peer: RTCPeerConnection) => {
    const pending = pendingIceCandidatesRef.current.get(participantId)
    if (!pending?.length) return

    for (const candidate of pending) {
      try {
        await peer.addIceCandidate(candidate)
      } catch (error) {
        console.error("[MyMeet] Failed queued ICE:", error)
      }
    }

    pendingIceCandidatesRef.current.delete(participantId)
  }, [])

  /* =======================================================
     CREATE OFFER
     ======================================================= */

  const createOffer = useCallback(
    async (remoteParticipantId: string) => {
      if (participantIdRef.current >= remoteParticipantId) return

      let peer = peerConnectionsRef.current.get(remoteParticipantId)
      if (!peer) {
        peer = createPeer(remoteParticipantId)
      }

      let state = peerStatesRef.current.get(remoteParticipantId)
      if (!state) {
        state = { makingOffer: false, ignoreOffer: false }
        peerStatesRef.current.set(remoteParticipantId, state)
      }

      if (state.makingOffer || peer.signalingState !== "stable") return

      state.makingOffer = true

      try {
        const offer = await peer.createOffer()
        if (peer.signalingState !== "stable") return

        await peer.setLocalDescription(offer)
        if (!peer.localDescription || peer.localDescription.type !== "offer") return

        publish("/app/webrtc/offer", {
          roomId,
          participantId: participantIdRef.current,
          targetParticipantId: remoteParticipantId,
          offer: peer.localDescription,
        })
      } catch (error) {
        console.error("[MyMeet] Failed to create offer:", error)
        if (error instanceof DOMException && (error.name === "InvalidAccessError" || error.name === "InvalidStateError")) {
          closePeer(remoteParticipantId)
        }
      } finally {
        state.makingOffer = false
      }
    },
    [closePeer, createPeer, publish, roomId]
  )

  /* =======================================================
     SIGNALING
     ======================================================= */

  const signal = useCallback(
    async (raw: IMessage) => {
      try {
        const parsed = JSON.parse(raw.body) as Signal
        const type = (parsed.type || parsed.event || "").toUpperCase()
        const data = parsed.data || parsed

        if (type === "ROOM_STATE" || type === "ROOMSTATE") {
          const roomParticipants = data.participants || []
          const normalized = normalizeParticipants(roomParticipants)

          setParticipants((current) =>
            normalized.map((participant) => {
              const existing = current.find((item) => item.id === participant.id)
              return {
                ...participant,
                stream: existing?.stream,
              }
            })
          )

          // Mark meeting as fully ready once initial room state is obtained
          setJoinPhase("ready")
          if (slowNoticeTimerRef.current) clearTimeout(slowNoticeTimerRef.current)
          setSlowServerNotice(false)

          for (const participant of normalized) {
            if (participant.id === participantIdRef.current) continue
            if (participantIdRef.current < participant.id) {
              await createOffer(participant.id)
            }
          }
          return
        }

        if (type === "PARTICIPANT_JOINED" || type === "JOIN" || type === "PARTICIPANT-JOINED") {
          const remoteId = data.participantId
          if (!remoteId || remoteId === participantIdRef.current) return

          setParticipants((current) => {
            if (current.some((p) => p.id === remoteId)) return current
            return [...current, { id: remoteId, name: data.name || "Guest" }]
          })

          await createOffer(remoteId)
          return
        }

        if (type === "JOIN_REJECTED") {
          setJoinError(data.message || "You are already participating in this meeting.")
          setJoined(false)
          setJoinPhase("error")
          joiningRef.current = false
          if (slowNoticeTimerRef.current) clearTimeout(slowNoticeTimerRef.current)
          return
        }

        if (type === "CHAT_MESSAGE" || type === "CHAT" || type === "MESSAGE") {
          const text = data.message || data.text || ""
          if (!text) return

          setMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              participantId: data.participantId || "",
              name: data.name || "Guest",
              text,
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          ])
          return
        }

        if (type === "WEBRTC_OFFER" || type === "OFFER") {
          const remoteParticipantId = data.participantId
          const targetParticipantId = data.targetParticipantId
          const offer = data.offer

          if (!remoteParticipantId || remoteParticipantId === participantIdRef.current || !offer) return
          if (targetParticipantId && targetParticipantId !== participantIdRef.current) return

          const peer = createPeer(remoteParticipantId)
          let state = peerStatesRef.current.get(remoteParticipantId)

          if (!state) {
            state = { makingOffer: false, ignoreOffer: false }
            peerStatesRef.current.set(remoteParticipantId, state)
          }

          const offerCollision = state.makingOffer || peer.signalingState !== "stable"
          const polite = participantIdRef.current > remoteParticipantId

          state.ignoreOffer = !polite && offerCollision
          if (state.ignoreOffer) return

          try {
            if (offerCollision && polite) {
              await peer.setLocalDescription({ type: "rollback" })
            }

            if (peer.signalingState !== "stable") return

            await peer.setRemoteDescription(offer)
            await applyPendingIce(remoteParticipantId, peer)

            const answer = await peer.createAnswer()
            await peer.setLocalDescription(answer)

            if (!peer.localDescription || peer.localDescription.type !== "answer") return

            publish("/app/webrtc/answer", {
              roomId,
              participantId: participantIdRef.current,
              targetParticipantId: remoteParticipantId,
              answer: peer.localDescription,
            })
          } catch (error) {
            console.error("[MyMeet] Failed offer:", remoteParticipantId, error)
            if (error instanceof DOMException && (error.name === "InvalidStateError" || error.name === "InvalidAccessError")) {
              closePeer(remoteParticipantId)
            }
          } finally {
            state.makingOffer = false
          }
          return
        }

        if (type === "WEBRTC_ANSWER" || type === "ANSWER") {
          const remoteParticipantId = data.participantId
          const targetParticipantId = data.targetParticipantId
          const answer = data.answer

          if (!remoteParticipantId || remoteParticipantId === participantIdRef.current || !answer) return
          if (targetParticipantId && targetParticipantId !== participantIdRef.current) return

          const peer = peerConnectionsRef.current.get(remoteParticipantId)
          if (!peer || peer.signalingState !== "have-local-offer") return

          try {
            await peer.setRemoteDescription(answer)
            await applyPendingIce(remoteParticipantId, peer)
          } catch (error) {
            console.error("[MyMeet] Failed answer:", remoteParticipantId, error)
          }
          return
        }

        if (type === "WEBRTC_ICE" || type === "ICE" || type === "CANDIDATE") {
          const remoteParticipantId = data.participantId
          const targetParticipantId = data.targetParticipantId
          const candidate = data.candidate

          if (!remoteParticipantId || remoteParticipantId === participantIdRef.current || !candidate) return
          if (targetParticipantId && targetParticipantId !== participantIdRef.current) return

          const peer = peerConnectionsRef.current.get(remoteParticipantId)

          if (!peer || !peer.remoteDescription) {
            const pending = pendingIceCandidatesRef.current.get(remoteParticipantId) || []
            pending.push(candidate)
            pendingIceCandidatesRef.current.set(remoteParticipantId, pending)
            return
          }

          try {
            await peer.addIceCandidate(candidate)
          } catch (error) {
            const state = peerStatesRef.current.get(remoteParticipantId)
            if (!state?.ignoreOffer) {
              console.error("[MyMeet] Failed ICE:", remoteParticipantId, error)
            }
          }
          return
        }

        if (type === "PARTICIPANT_LEFT" || type === "LEAVE" || type === "PARTICIPANT-LEFT") {
          const remoteParticipantId = data.participantId
          if (remoteParticipantId && remoteParticipantId !== participantIdRef.current) {
            closePeer(remoteParticipantId)
            setParticipants((current) => current.filter((p) => p.id !== remoteParticipantId))
            if (pinnedParticipantId === remoteParticipantId) {
              setPinnedParticipantId(null)
            }
          }
          return
        }
      } catch (error) {
        console.error("[MyMeet] STOMP signal parse error:", error)
      }
    },
    [applyPendingIce, closePeer, createOffer, createPeer, normalizeParticipants, pinnedParticipantId, publish, roomId]
  )

  /* =======================================================
     JOIN MEETING
     ======================================================= */

  const join = useCallback(async () => {
    if (joiningRef.current || joined) return

    joiningRef.current = true
    leavingRef.current = false
    setJoinError(null)
    setSlowServerNotice(false)
    setJoinPhase("requesting_media")

    // Slow connection timeout feedback
    slowNoticeTimerRef.current = setTimeout(() => {
      setSlowServerNotice(true)
    }, 6000)

    try {
      if (!participantIdRef.current) {
        participantIdRef.current = crypto.randomUUID()
      }

      const displayName = name.trim() || "Guest"
      nameRef.current = displayName
      sessionStorage.setItem("mymeet-name", displayName)
      setName(displayName)
      setStatus("connecting")

      const stream = await getLocalMedia()
      if (!stream) {
        setMediaWarning("You joined without camera/microphone. You can still view/listen.")
      }

      setParticipants([
        {
          id: participantIdRef.current,
          name: displayName,
          stream: stream || undefined,
        },
      ])

      setJoined(true)
      setJoinPhase("connecting_ws")

      const client = new Client({
        brokerURL: getBackendWsUrl(),
        reconnectDelay: 5000,
        onConnect: () => {
          if (leavingRef.current) return
          setStatus("connected")

          setJoinPhase("subscribing")
          const subscription = client.subscribe(`/topic/meet/${roomId}`, signal)
          subscriptionsRef.current = [subscription]

          setJoinPhase("joining_room")
          client.publish({
            destination: "/app/meet/join",
            body: JSON.stringify({
              roomId,
              participantId: participantIdRef.current,
              name: nameRef.current,
            }),
          })

          setJoinPhase("waiting_room_state")
        },
        onStompError: () => {
          if (mountedRef.current) {
            setStatus("offline")
            setJoinError("Unable to connect to the meeting server.")
            setJoinPhase("error")
            joiningRef.current = false
            if (slowNoticeTimerRef.current) clearTimeout(slowNoticeTimerRef.current)
          }
        },
        onWebSocketError: () => {
          if (mountedRef.current) {
            setStatus("offline")
            setJoinError("WebSocket connection failed.")
            setJoinPhase("error")
            joiningRef.current = false
            if (slowNoticeTimerRef.current) clearTimeout(slowNoticeTimerRef.current)
          }
        },
        onWebSocketClose: () => {
          if (mountedRef.current && !leavingRef.current) setStatus("offline")
        },
      })

      clientRef.current = client
      client.activate()
    } catch (err) {
      console.error("[MyMeet] Join process failed:", err)
      setJoinError("An unexpected error occurred while joining.")
      setJoinPhase("error")
      joiningRef.current = false
      if (slowNoticeTimerRef.current) clearTimeout(slowNoticeTimerRef.current)
    }
  }, [getLocalMedia, joined, name, roomId, signal])

  /* =======================================================
     CLEANUP & LEAVE
     ======================================================= */

  const cleanup = useCallback(async () => {
    if (leavingRef.current) return
    leavingRef.current = true
    setIsLeaving(true)

    if (slowNoticeTimerRef.current) clearTimeout(slowNoticeTimerRef.current)

    const client = clientRef.current
    if (client && client.connected) {
      try {
        client.publish({
          destination: "/app/meet/leave",
          body: JSON.stringify({
            roomId,
            participantId: participantIdRef.current,
            name: nameRef.current,
          }),
        })
      } catch (error) {
        console.error("[MyMeet] Leave error:", error)
      }
      await new Promise<void>((res) => setTimeout(res, 100))
    }

    subscriptionsRef.current.forEach((sub) => {
      try {
        sub.unsubscribe()
      } catch {}
    })
    subscriptionsRef.current = []

    peerConnectionsRef.current.forEach((_, id) => closePeer(id))
    peerConnectionsRef.current.clear()
    peerStatesRef.current.clear()
    pendingIceCandidatesRef.current.clear()

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop())
      localStreamRef.current = null
    }

    if (localVideoElementRef.current) {
      localVideoElementRef.current.srcObject = null
    }

    if (client) {
      try {
        await client.deactivate()
      } catch {}
    }

    clientRef.current = null

    setParticipants([])
    setJoined(false)
    setJoinPhase("idle")
    setStatus("offline")
    setMessages([])
    setDraft("")
    setMediaWarning(null)
    setJoinError(null)
    setPinnedParticipantId(null)
    setSlowServerNotice(false)
    setIsLeaving(false)

    joiningRef.current = false
    leavingRef.current = false
  }, [closePeer, roomId])

  const leaveMeeting = useCallback(async () => {
    await cleanup()
  }, [cleanup])

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      peerConnectionsRef.current.forEach((peer) => {
        try {
          peer.close()
        } catch {}
      })
      subscriptionsRef.current.forEach((sub) => {
        try {
          sub.unsubscribe()
        } catch {}
      })
      if (clientRef.current) {
        clientRef.current.deactivate().catch(() => {})
      }
    }
  }, [])

  /* =======================================================
     CONTROLS & CHAT ACTIONS
     ======================================================= */

  const copyMeetUrl = useCallback(() => {
    if (typeof window !== "undefined") {
      void navigator.clipboard.writeText(window.location.href)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    }
  }, [])

  const sendMessage = useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault()
      const text = draft.trim()
      if (!text) return

      const sent = publish("/app/meet/message", {
        roomId,
        participantId: participantIdRef.current,
        name: nameRef.current,
        message: text,
      })

      if (sent) setDraft("")
    },
    [draft, publish, roomId]
  )

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return

    const next = !micOn
    stream.getAudioTracks().forEach((track) => {
      track.enabled = next
    })

    setMicOn(next)
    setParticipants((current) =>
      current.map((p) =>
        p.id === participantIdRef.current ? { ...p, muted: !next } : p
      )
    )
  }, [micOn])

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return

    const next = !cameraOn
    stream.getVideoTracks().forEach((track) => {
      track.enabled = next
    })

    setCameraOn(next)
    setParticipants((current) =>
      current.map((p) =>
        p.id === participantIdRef.current ? { ...p, cameraOff: !next } : p
      )
    )
  }, [cameraOn])

  const setRemoteVideoRef = useCallback(
    (participantId: string, element: HTMLVideoElement | null) => {
      if (!element) {
        remoteVideoRefs.current.delete(participantId)
        return
      }

      remoteVideoRefs.current.set(participantId, element)
      const participant = participants.find((item) => item.id === participantId)

      if (participant?.stream && element.srcObject !== participant.stream) {
        element.srcObject = participant.stream
        void element.play().catch(() => {})
      }
    },
    [participants]
  )

  /* =======================================================
     GRID CONFIG CALCULATOR
     ======================================================= */

  const getGridClass = (count: number) => {
    if (count <= 1) return "grid-cols-1 max-w-4xl"
    if (count === 2) return "grid-cols-1 sm:grid-cols-2 max-w-5xl"
    if (count <= 4) return "grid-cols-2 max-w-6xl"
    if (count <= 6) return "grid-cols-2 md:grid-cols-3 max-w-7xl"
    if (count <= 9) return "grid-cols-3 md:grid-cols-3 max-w-7xl"
    return "grid-cols-2 md:grid-cols-4 max-w-full"
  }

  /* =======================================================
     JOIN SCREEN
     ======================================================= */

  const isJoiningPending = joinPhase !== "idle" && joinPhase !== "ready" && joinPhase !== "error"

  if (!joined) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#181d1b] px-4 text-[#f0f3f1]">
        <div className="w-full max-w-md rounded-3xl bg-[#222a27] p-8 shadow-2xl border border-white/10">
          <div className="mb-8 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-2xl bg-[#e76f51] text-white shadow-lg shadow-[#e76f51]/20">
                <Video size={20} />
              </span>
              <span className="text-xl font-bold tracking-wide">MyMeet</span>
            </div>

            <Link
              href="/"
              className="text-xs font-medium text-[#a0aba6] hover:text-white transition-colors"
            >
              Back to Home
            </Link>
          </div>

          <p className="text-xs uppercase font-semibold tracking-wider text-[#a0aba6]">
            You&apos;re joining
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">{roomId}</h1>

          <label className="mt-6 block text-sm font-medium text-[#d0d7d4]">
            Your Name
            <input
              value={name}
              disabled={isJoiningPending}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isJoiningPending) void join()
              }}
              placeholder="e.g. Nora Patel"
              className="mt-2 w-full rounded-xl border border-white/10 bg-[#181d1b] px-4 py-3 text-white placeholder:text-[#606b66] outline-none focus:border-[#e76f51] focus:ring-1 focus:ring-[#e76f51] transition-all disabled:opacity-50"
            />
          </label>

          {joinError && (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
              {joinError}
            </div>
          )}

          {mediaError && (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
              {mediaError}
              <p className="mt-1 text-[11px] opacity-80">
                You can still join without audio/video capabilities.
              </p>
            </div>
          )}

          <button
            onClick={() => void join()}
            disabled={isJoiningPending}
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#e76f51] px-4 text-sm font-semibold text-white shadow-lg shadow-[#e76f51]/25 hover:bg-[#d05d41] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-75 transition-all"
          >
            {isJoiningPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Joining...</span>
              </>
            ) : (
              <>
                <span>Join Meeting</span>
                <Link2 size={16} />
              </>
            )}
          </button>

          <p className="mt-4 text-center text-xs text-[#7b8581]">
            No registration required.
          </p>
        </div>
      </main>
    )
  }

  /* =======================================================
     MEETING UI WITH LOADING OVERLAY
     ======================================================= */

  const pinnedParticipant = participants.find((p) => p.id === pinnedParticipantId)
  const unpinnedParticipants = participants.filter((p) => p.id !== pinnedParticipantId)
  const isInitializing = joinPhase !== "ready"

  const getJoinPhaseLabel = (phase: JoinPhase) => {
    switch (phase) {
      case "requesting_media":
        return "Accessing camera & microphone..."
      case "connecting_ws":
        return "Connecting to server..."
      case "subscribing":
        return "Subscribing to meeting channel..."
      case "joining_room":
        return "Sending join request..."
      case "waiting_room_state":
        return "Initializing room state..."
      default:
        return "Joining meeting..."
    }
  }

  return (
    <main className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#121615] text-[#f0f3f1]">
      {/* FULL-SCREEN MEETING INITIALIZATION LOADING OVERLAY */}
      {isInitializing && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#121615]/95 backdrop-blur-md p-4 text-center">
          <div className="flex flex-col items-center gap-4 rounded-3xl border border-white/10 bg-[#181d1b] p-8 shadow-2xl max-w-sm w-full">
            <Loader2 size={36} className="animate-spin text-[#e76f51]" />
            <div>
              <p className="text-base font-semibold text-white">
                {getJoinPhaseLabel(joinPhase)}
              </p>
              <p className="mt-1 text-xs text-[#828e88]">
                {slowServerNotice
                  ? "The server is taking longer than usual. Please wait..."
                  : "Please wait while we establish your secure WebRTC session."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/5 bg-[#181d1b] px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#e76f51] text-white">
            <Video size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight text-white">{roomId}</p>
            <p className="text-[11px] text-[#828e88]">
              {participants.length} participant{participants.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Copy URL Reusable Action Button */}
          <button
            onClick={copyMeetUrl}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-white/5 px-3 text-xs font-medium text-[#a0aba6] hover:bg-white/10 hover:text-white transition-colors"
            title="Copy Meeting Link"
          >
            {copiedUrl ? (
              <>
                <Check size={14} className="text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={14} />
                <span className="hidden sm:inline">Copy Link</span>
              </>
            )}
          </button>

          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              status === "connected"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
            }`}
          >
            {status === "connected" ? <Wifi size={12} /> : <WifiOff size={12} />}
            <span className="hidden sm:inline">
              {status === "connected" ? "Connected" : "Reconnecting"}
            </span>
          </div>

          <button
            onClick={() => setChatOpen((prev) => !prev)}
            className={`relative rounded-xl p-2.5 transition-colors ${
              chatOpen ? "bg-[#e76f51] text-white" : "bg-white/5 text-[#a0aba6] hover:bg-white/10 hover:text-white"
            }`}
            aria-label="Toggle chat"
          >
            <MessageCircle size={18} />
            {messages.length > 0 && !chatOpen && (
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-[#e76f51] ring-2 ring-[#181d1b]" />
            )}
          </button>
        </div>
      </header>

      {/* MEDIA WARNING */}
      {mediaWarning && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-center text-xs text-amber-300">
          {mediaWarning}
        </div>
      )}

      {/* MAIN WORKSPACE */}
      <div className="relative flex flex-1 overflow-hidden p-3 lg:p-4 gap-3">
        {/* VIDEO CONTAINER */}
        <div className="flex flex-1 flex-col overflow-hidden items-center justify-center">
          {pinnedParticipant ? (
            /* PINNED LAYOUT MODE */
            <div className="flex size-full flex-col lg:flex-row gap-3 overflow-hidden">
              {/* Main Stage */}
              <div className="relative flex-1 rounded-2xl overflow-hidden bg-[#1a201e] border border-white/5 flex items-center justify-center">
                <ParticipantCard
                  participant={pinnedParticipant}
                  isLocal={pinnedParticipant.id === participantIdRef.current}
                  setLocalVideoRef={setLocalVideoRef}
                  setRemoteVideoRef={setRemoteVideoRef}
                  isPinned={true}
                  cameraOn={cameraOn}
                  onUnpin={() => setPinnedParticipantId(null)}
                />
              </div>

              {/* Thumbnails Sidebar */}
              <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:w-64 shrink-0 p-1">
                {unpinnedParticipants.map((p) => (
                  <div key={p.id} className="h-28 w-44 lg:w-full lg:h-36 shrink-0 rounded-xl overflow-hidden relative border border-white/5 bg-[#1a201e]">
                    <ParticipantCard
                      participant={p}
                      isLocal={p.id === participantIdRef.current}
                      setLocalVideoRef={setLocalVideoRef}
                      setRemoteVideoRef={setRemoteVideoRef}
                      cameraOn={cameraOn}
                      onPin={() => setPinnedParticipantId(p.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* DYNAMIC RESPONSIVE GRID MODE */
            <div className="size-full flex items-center justify-center overflow-y-auto p-1">
              <div className={`grid w-full gap-3 transition-all duration-300 auto-rows-fr ${getGridClass(participants.length)}`}>
                {participants.map((p, idx) => (
                  <div
                    key={p.id}
                    className="relative w-full aspect-video min-h-[160px] max-h-[75vh] rounded-2xl overflow-hidden border border-white/5 bg-[#1a201e] shadow-md"
                  >
                    <ParticipantCard
                      participant={p}
                      isLocal={p.id === participantIdRef.current}
                      setLocalVideoRef={setLocalVideoRef}
                      setRemoteVideoRef={setRemoteVideoRef}
                      bgColor={colors[idx % colors.length]}
                      cameraOn={cameraOn}
                      onPin={() => setPinnedParticipantId(p.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SIDEBAR CHAT PANEL */}
        {chatOpen && (
          <aside className="absolute inset-y-3 right-3 z-20 flex w-80 flex-col rounded-2xl border border-white/10 bg-[#181d1b] shadow-2xl lg:relative lg:inset-0">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/5 px-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#a0aba6]">In-Call Messages</h2>
              <button
                onClick={() => setChatOpen(false)}
                className="rounded-lg p-1 text-[#a0aba6] hover:bg-white/5 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-[#606b66]">
                  No messages yet. Send a message to start chatting!
                </div>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.participantId === participantIdRef.current
                  return (
                    <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                      <div className="flex items-center gap-1.5 mb-1 text-[10px] text-[#828e88]">
                        <span>{isMe ? "You" : msg.name}</span>
                        <span>•</span>
                        <span>{msg.time}</span>
                      </div>
                      <div
                        className={`rounded-xl px-3 py-2 max-w-[85%] text-sm break-words ${
                          isMe
                            ? "bg-[#e76f51] text-white rounded-br-none"
                            : "bg-white/5 text-[#d0d7d4] rounded-bl-none border border-white/5"
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <form onSubmit={sendMessage} className="flex shrink-0 gap-2 border-t border-white/5 p-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Send a message..."
                className="flex-1 rounded-xl bg-white/5 px-3 py-2 text-xs text-white placeholder:text-[#606b66] outline-none focus:ring-1 focus:ring-[#e76f51]"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#e76f51] text-white disabled:opacity-40 hover:bg-[#d05d41] transition-colors"
              >
                <Send size={14} />
              </button>
            </form>
          </aside>
        )}
      </div>

      {/* BOTTOM CONTROL BAR */}
      <footer className="flex h-20 shrink-0 items-center justify-center border-t border-white/5 bg-[#181d1b] px-4">
        <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-2 border border-white/5 backdrop-blur-md">
          <button
            onClick={toggleMic}
            className={`grid size-12 place-items-center rounded-xl transition-all ${
              micOn
                ? "bg-white/10 text-white hover:bg-white/20"
                : "bg-red-500/20 text-red-400 border border-red-500/30"
            }`}
            title={micOn ? "Mute Microphone" : "Unmute Microphone"}
          >
            {micOn ? <Mic size={20} /> : <MicOff size={20} />}
          </button>

          <button
            onClick={toggleCamera}
            className={`grid size-12 place-items-center rounded-xl transition-all ${
              cameraOn
                ? "bg-white/10 text-white hover:bg-white/20"
                : "bg-red-500/20 text-red-400 border border-red-500/30"
            }`}
            title={cameraOn ? "Turn Camera Off" : "Turn Camera On"}
          >
            {cameraOn ? <Video size={20} /> : <VideoOff size={20} />}
          </button>

          <button
            onClick={() => void leaveMeeting()}
            disabled={isLeaving}
            className="grid size-12 place-items-center rounded-xl bg-red-600 text-white hover:bg-red-700 active:scale-95 disabled:opacity-50 transition-all shadow-lg shadow-red-600/20"
            title="Leave Meeting"
          >
            {isLeaving ? <Loader2 size={20} className="animate-spin" /> : <PhoneOff size={20} />}
          </button>
        </div>
      </footer>
    </main>
  )
}

/* =========================================================
   PARTICIPANT CARD SUB-COMPONENT
   ========================================================= */

type ParticipantCardProps = {
  participant: Participant
  isLocal: boolean
  setLocalVideoRef: (el: HTMLVideoElement | null) => void
  setRemoteVideoRef: (id: string, el: HTMLVideoElement | null) => void
  bgColor?: string
  isPinned?: boolean
  cameraOn?: boolean
  onPin?: () => void
  onUnpin?: () => void
}

function ParticipantCard({
  participant,
  isLocal,
  setLocalVideoRef,
  setRemoteVideoRef,
  bgColor = "bg-stone-800",
  isPinned = false,
  cameraOn = true,
  onPin,
  onUnpin,
}: ParticipantCardProps) {
  const isCameraActive = isLocal ? cameraOn : Boolean(participant.stream) && !participant.cameraOff

  return (
    <div className={`relative size-full flex items-center justify-center overflow-hidden ${bgColor}`}>
      {/* Local Video Stream */}
      {isLocal ? (
        <video
          ref={setLocalVideoRef}
          autoPlay
          muted
          playsInline
          className={`size-full object-cover ${!isCameraActive ? "hidden" : ""}`}
        />
      ) : (
        /* Remote Video Stream */
        <video
          ref={(el) => setRemoteVideoRef(participant.id, el)}
          autoPlay
          playsInline
          className={`size-full object-cover ${!isCameraActive ? "hidden" : ""}`}
        />
      )}

      {/* Fallback Avatar display when camera is off */}
      {!isCameraActive && (
        <div className="flex flex-col items-center justify-center gap-2">
          <span className="grid size-16 place-items-center rounded-full bg-white/10 text-xl font-bold text-white ring-1 ring-white/20">
            {initials(participant.name)}
          </span>
        </div>
      )}

      {/* Overlay UI Controls & Info Bar */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-8">
        <span className="text-xs font-medium text-white truncate max-w-[70%]">
          {participant.name} {isLocal && "(You)"}
        </span>

        <div className="flex items-center gap-1.5">
          <span className={`rounded-full p-1 ${participant.muted ? "bg-red-500/80 text-white" : "bg-black/40 text-white/80"}`}>
            {participant.muted ? <MicOff size={12} /> : <Mic size={12} />}
          </span>

          {isPinned ? (
            <button
              onClick={onUnpin}
              className="rounded-full bg-black/40 p-1 text-white/80 hover:bg-white/20 hover:text-white"
              title="Unpin stream"
            >
              <PinOff size={12} />
            </button>
          ) : (
            onPin && (
              <button
                onClick={onPin}
                className="rounded-full bg-black/40 p-1 text-white/80 hover:bg-white/20 hover:text-white"
                title="Pin stream"
              >
                <Pin size={12} />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}