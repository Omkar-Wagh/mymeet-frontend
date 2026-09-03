"use client"

import {
  Client,
  type IMessage,
  type StompSubscription,
} from "@stomp/stompjs"

import {
  Check,
  Copy,
  Hand,
  Link2,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Pin,
  PinOff,
  Send,
  Smile,
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
  type FormEvent,
} from "react"

/* =========================================================
   TYPES
   ========================================================= */

type Participant = {
  id: string
  name: string
  stream?: MediaStream
  muted: boolean
  cameraOff: boolean
  handRaised: boolean
  screenSharing: boolean
  reaction?: string | null
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
  muted?: boolean
  cameraOff?: boolean
  handRaised?: boolean
  screenSharing?: boolean
  reaction?: string | null
}

type Signal = {
  type?: string
  event?: string

  roomId?: string
  participantId?: string
  targetParticipantId?: string

  name?: string
  message?: string
  text?: string

  muted?: boolean
  cameraOff?: boolean
  handRaised?: boolean
  screenSharing?: boolean

  emoji?: string

  offer?: RTCSessionDescriptionInit
  answer?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit

  participants?: RoomParticipant[]

  data?: {
    type?: string
    event?: string

    roomId?: string
    participantId?: string
    targetParticipantId?: string

    name?: string
    message?: string
    text?: string

    muted?: boolean
    cameraOff?: boolean
    handRaised?: boolean
    screenSharing?: boolean
    reaction?: string | null

    emoji?: string

    offer?: RTCSessionDescriptionInit
    answer?: RTCSessionDescriptionInit
    candidate?: RTCIceCandidateInit

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
   CONSTANTS
   ========================================================= */

const REACTION_EMOJIS = [
  "👍",
  "👏",
  "❤️",
  "🔥",
  "🎉",
  "😮",
]

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
  process.env.NEXT_PUBLIC_BACKEND_WS_URL ||
  "ws://localhost:8080/ws"

/* =========================================================
   COMPONENT
   ========================================================= */

export default function MeetingRoom({
  roomId,
}: {
  roomId: string
}) {
  /* =======================================================
     STATE
     ======================================================= */

  const [name, setName] = useState("")
  const [joined, setJoined] = useState(false)

  const [joinPhase, setJoinPhase] =
    useState<JoinPhase>("idle")

  const [slowServerNotice, setSlowServerNotice] =
    useState(false)

  const [copiedUrl, setCopiedUrl] =
    useState(false)

  const [isLeaving, setIsLeaving] =
    useState(false)

  const [participants, setParticipants] =
    useState<Participant[]>([])

  const [pinnedParticipantId, setPinnedParticipantId] =
    useState<string | null>(null)

  const [messages, setMessages] =
    useState<ChatMessage[]>([])

  const [draft, setDraft] =
    useState("")

  const [chatOpen, setChatOpen] =
    useState(false)

  const [micOn, setMicOn] =
    useState(true)

  const [cameraOn, setCameraOn] =
    useState(true)

  const [isScreenSharing, setIsScreenSharing] =
    useState(false)

  const [handRaised, setHandRaised] =
    useState(false)

  const [showReactions, setShowReactions] =
    useState(false)

  const [status, setStatus] =
    useState<"connecting" | "connected" | "offline">(
      "connecting"
    )

  const [mediaError, setMediaError] =
    useState<string | null>(null)

  const [mediaWarning, setMediaWarning] =
    useState<string | null>(null)

  const [joinError, setJoinError] =
    useState<string | null>(null)

  const [sessionReplaced, setSessionReplaced] =
    useState(false)

  /* =======================================================
     REFS
     ======================================================= */

  const clientRef =
    useRef<Client | null>(null)

  const subscriptionsRef =
    useRef<StompSubscription[]>([])

  const localStreamRef =
    useRef<MediaStream | null>(null)

  const screenStreamRef =
    useRef<MediaStream | null>(null)

  const localVideoElementRef =
    useRef<HTMLVideoElement | null>(null)

  const participantIdRef =
    useRef<string>("")

  /*
   * Unique identity for this browser tab's active MyMeet session.
   * The participantId remains stable across reconnects, while this
   * value lets the backend/frontend distinguish a replaced tab.
   */
  const connectionIdRef =
    useRef<string>("")

  /*
   * Keep one logical participant identity for this room
   * across refreshes/reconnects in the same browser tab.
   */
  const participantStorageKey =
    `mymeet:${roomId}:participantId`

  const establishedConnectionRef =
    useRef(false)

  const nameRef =
    useRef<string>("Guest")

  const peerConnectionsRef =
    useRef<Map<string, RTCPeerConnection>>(
      new Map()
    )

  const peerStatesRef =
    useRef<Map<string, PeerState>>(
      new Map()
    )

  const remoteVideoRefs =
    useRef<Map<string, HTMLVideoElement>>(
      new Map()
    )

  const pendingIceCandidatesRef =
    useRef<Map<string, RTCIceCandidateInit[]>>(
      new Map()
    )

  const leavingRef =
    useRef(false)

  const joiningRef =
    useRef(false)

  const mountedRef =
    useRef(true)

  const slowNoticeTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null
    )

  /*
   * Keep one reaction timer per participant.
   * This prevents an older reaction timeout from
   * clearing a newer reaction too early.
   */
  const reactionTimersRef =
    useRef<
      Map<
        string,
        ReturnType<typeof setTimeout>
      >
    >(new Map())

  /* =======================================================
     INITIALIZE PARTICIPANT
     ======================================================= */


  /* =========================================================
   INITIALIZE PARTICIPANT
   ========================================================= */

    useEffect(() => {
      /*
       * React Strict Mode runs effects as:
       * setup -> cleanup -> setup.
       * Always restore the mounted flag at setup time.
       */
      mountedRef.current = true

      if (!connectionIdRef.current) {
        connectionIdRef.current =
          crypto.randomUUID()
      }

      if (!participantIdRef.current) {
        const storedParticipantId =
          localStorage.getItem(
            participantStorageKey
          )

        participantIdRef.current =
          storedParticipantId ||
          crypto.randomUUID()

        localStorage.setItem(
          participantStorageKey,
          participantIdRef.current
        )
      }

      const storedName =
        sessionStorage.getItem("mymeet-name")

      if (storedName) {
        nameRef.current = storedName
        setName(storedName)
      }

      return () => {
        mountedRef.current = false

        if (slowNoticeTimerRef.current) {
          clearTimeout(
            slowNoticeTimerRef.current
          )
        }
      }
    }, [])


  /* =======================================================
     LOCAL VIDEO REF
     ======================================================= */

  /*
   * The local <video> element can be unmounted/remounted when
   * pinning, opening chat, or changing the responsive layout.
   * Always bind the current active stream after the element exists.
   */
  const bindLocalVideo = useCallback(() => {
    const video =
      localVideoElementRef.current

    if (!video) {
      return
    }

    const activeStream =
      screenStreamRef.current ||
      localStreamRef.current

    if (!activeStream) {
      video.srcObject = null
      return
    }

    if (video.srcObject !== activeStream) {
      video.srcObject = activeStream
    }

    video.muted = true
    video.autoplay = true
    video.playsInline = true

    if (video.paused) {
      void video.play().catch(() => {})
    }
  }, [])

  const setLocalVideoRef = useCallback(
    (element: HTMLVideoElement | null) => {
      localVideoElementRef.current =
        element

      if (element) {
        bindLocalVideo()
      }
    },
    [bindLocalVideo]
  )

  /*
   * Rebind after layout/remount changes.
   * requestAnimationFrame waits until React has committed
   * the new video element to the DOM.
   */
  useEffect(() => {
    if (!joined) {
      return
    }

    let frameId = 0

    frameId =
      requestAnimationFrame(() => {
        bindLocalVideo()
      })

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [
    bindLocalVideo,
    joined,
    cameraOn,
    isScreenSharing,
    chatOpen,
    pinnedParticipantId,
  ])

  /* =======================================================
     PUBLISH
     ======================================================= */

  const publish = useCallback(
    (
      destination: string,
      body: unknown
    ) => {
      const client = clientRef.current

      if (
        !client ||
        !client.connected ||
        leavingRef.current
      ) {
        return false
      }

      try {
        client.publish({
          destination,
          body: JSON.stringify(body),
        })

        return true
      } catch {
        return false
      }
    },
    []
  )

  /* =======================================================
     LOCAL MEDIA
     ======================================================= */

  const getLocalMedia =
    useCallback(async (): Promise<MediaStream | null> => {
      if (localStreamRef.current) {
        return localStreamRef.current
      }

      setMediaError(null)
      setMediaWarning(null)

      try {
        const stream =
          await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true,
          })

        localStreamRef.current = stream

        /*
         * If the video element is already mounted, immediately
         * attach the newly acquired stream. The layout effect
         * below will also rebind after React updates.
         */
        bindLocalVideo()

        const audioEnabled =
          stream
            .getAudioTracks()
            .some(
              (track) => track.enabled
            )

        const videoEnabled =
          stream
            .getVideoTracks()
            .some(
              (track) => track.enabled
            )

        setMicOn(audioEnabled)
        setCameraOn(videoEnabled)

        return stream
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name ===
            "NotReadableError"
        ) {
          setMediaError(
            "Camera or microphone could not be started. Another app may be using it."
          )
        } else if (
          error instanceof DOMException &&
          error.name ===
            "NotAllowedError"
        ) {
          setMediaError(
            "Camera or microphone permission was denied."
          )
        } else if (
          error instanceof DOMException &&
          error.name ===
            "NotFoundError"
        ) {
          setMediaError(
            "No camera or microphone was found."
          )
        } else {
          setMediaError(
            "Unable to access camera or microphone."
          )
        }

        return null
      }
    }, [bindLocalVideo])

  /* =======================================================
     REMOTE STREAM
     ======================================================= */

  const setRemoteStream = useCallback(
    (
      participantId: string,
      stream: MediaStream
    ) => {
      if (leavingRef.current) {
        return
      }

      setParticipants((current) => {
        const participant =
          current.find(
            (item) =>
              item.id ===
              participantId
          )

        if (!participant) {
          return current
        }

        return current.map(
          (item) =>
            item.id ===
            participantId
              ? {
                  ...item,
                  stream,
                }
              : item
        )
      })

      const video =
        remoteVideoRefs.current.get(
          participantId
        )

      if (video) {
        if (
          video.srcObject !==
          stream
        ) {
          video.srcObject = stream
        }

        void video.play().catch(() => {})
      }
    },
    []
  )

  /* =======================================================
     CLOSE PEER
     ======================================================= */

  const closePeer = useCallback(
    (participantId: string) => {
      const peer =
        peerConnectionsRef.current.get(
          participantId
        )

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
          // Ignore already closed peer.
        }
      }

      peerConnectionsRef.current.delete(
        participantId
      )

      peerStatesRef.current.delete(
        participantId
      )

      pendingIceCandidatesRef.current.delete(
        participantId
      )

      const video =
        remoteVideoRefs.current.get(
          participantId
        )

      if (video) {
        video.srcObject = null
      }

      remoteVideoRefs.current.delete(
        participantId
      )
    },
    []
  )

  /* =======================================================
     REMOVE PARTICIPANT
     ======================================================= */

  const removeParticipant =
    useCallback(
      (participantId: string) => {
        if (
          !participantId ||
          participantId ===
            participantIdRef.current
        ) {
          return
        }

        closePeer(participantId)

        setParticipants((current) =>
          current.filter(
            (participant) =>
              participant.id !==
              participantId
          )
        )

        if (
          pinnedParticipantId ===
          participantId
        ) {
          setPinnedParticipantId(
            null
          )
        }
      },
      [
        closePeer,
        pinnedParticipantId,
      ]
    )

  /* =======================================================
     CREATE PEER
     ======================================================= */

  const createPeer = useCallback(
    (
      remoteParticipantId: string
    ): RTCPeerConnection => {
      const existing =
        peerConnectionsRef.current.get(
          remoteParticipantId
        )

      if (existing) {
        return existing
      }

      const peer =
        new RTCPeerConnection({
          iceServers: [
            {
              urls:
                "stun:stun.l.google.com:19302",
            },
          ],
        })

      peerStatesRef.current.set(
        remoteParticipantId,
        {
          makingOffer: false,
          ignoreOffer: false,
        }
      )

      const localStream =
        localStreamRef.current

      const screenStream =
        screenStreamRef.current

      if (localStream) {
        localStream
          .getAudioTracks()
          .forEach((track) => {
            peer.addTrack(
              track,
              localStream
            )
          })
      }

      const activeVideoTrack =
        screenStream?.getVideoTracks()[0] ||
        localStream?.getVideoTracks()[0]

      if (activeVideoTrack) {
        const videoStream =
          screenStream ||
          localStream

        if (videoStream) {
          peer.addTrack(
            activeVideoTrack,
            videoStream
          )
        }
      }

      peer.ontrack = (event) => {
        const remoteStream =
          event.streams[0]

        if (remoteStream) {
          setRemoteStream(
            remoteParticipantId,
            remoteStream
          )
        }
      }

      peer.onicecandidate = (event) => {
        if (!event.candidate) {
          return
        }

        publish(
          "/app/webrtc/ice",
          {
            roomId,
            participantId:
              participantIdRef.current,
            targetParticipantId:
              remoteParticipantId,
            candidate:
              event.candidate.toJSON(),
          }
        )
      }

      peer.onconnectionstatechange = () => {
        if (
          peer.connectionState ===
          "failed"
        ) {
          setTimeout(() => {
            const current =
              peerConnectionsRef.current.get(
                remoteParticipantId
              )

            if (
              current === peer &&
              peer.connectionState ===
                "failed"
            ) {
              closePeer(
                remoteParticipantId
              )
            }
          }, 2000)
        }

        if (
          peer.connectionState ===
          "closed"
        ) {
          closePeer(
            remoteParticipantId
          )
        }
      }

      peer.oniceconnectionstatechange = () => {
        if (
          peer.iceConnectionState ===
            "failed" ||
          peer.iceConnectionState ===
            "closed"
        ) {
          if (
            peer.connectionState !==
            "connected"
          ) {
            closePeer(
              remoteParticipantId
            )
          }
        }
      }

      peer.onsignalingstatechange = () => {
        // Intentionally empty.
      }

      peerConnectionsRef.current.set(
        remoteParticipantId,
        peer
      )

      return peer
    },
    [
      closePeer,
      publish,
      roomId,
      setRemoteStream,
    ]
  )

  /* =======================================================
     NORMALIZE PARTICIPANTS
     ======================================================= */

  const normalizeParticipants =
    useCallback(
      (
        input: RoomParticipant[]
      ): Participant[] => {
        const unique =
          new Map<
            string,
            Participant
          >()

        input.forEach(
          (participant) => {
            const id =
              participant.participantId ||
              participant.id

            if (!id) {
              return
            }

            const existing =
              unique.get(id)

            unique.set(id, {
              id,

              name:
                participant.name?.trim() ||
                existing?.name ||
                "Guest",

              muted:
                participant.muted ??
                existing?.muted ??
                false,

              cameraOff:
                participant.cameraOff ??
                existing?.cameraOff ??
                false,

              handRaised:
                participant.handRaised ??
                existing?.handRaised ??
                false,

              screenSharing:
                participant.screenSharing ??
                existing?.screenSharing ??
                false,

              /*
               * Reaction is also part of the participant snapshot when
               * the backend provides it. Never manufacture a reaction
               * value for a participant that has not supplied one.
               *
               * If the current ROOM_STATE does not contain reaction,
               * preserve the currently rendered transient reaction so
               * an unrelated join/leave snapshot cannot clear it.
               */
              reaction:
                participant.reaction !==
                undefined
                  ? participant.reaction
                  : existing?.reaction,

              stream:
                existing?.stream,
            })
          }
        )

        return Array.from(
          unique.values()
        )
      },
      []
    )

  /* =======================================================
     APPLY PENDING ICE
     ======================================================= */

  const applyPendingIce =
    useCallback(
      async (
        participantId: string,
        peer: RTCPeerConnection
      ) => {
        const pending =
          pendingIceCandidatesRef.current.get(
            participantId
          )

        if (!pending?.length) {
          return
        }

        for (const candidate of pending) {
          try {
            await peer.addIceCandidate(
              candidate
            )
          } catch {
            // Ignore invalid queued ICE.
          }
        }

        pendingIceCandidatesRef.current.delete(
          participantId
        )
      },
      []
    )

  /* =======================================================
     CREATE OFFER
     ======================================================= */

  const createOffer = useCallback(
    async (
      remoteParticipantId: string
    ) => {
      if (
        participantIdRef.current >=
        remoteParticipantId
      ) {
        return
      }

      let peer =
        peerConnectionsRef.current.get(
          remoteParticipantId
        )

      if (!peer) {
        peer =
          createPeer(
            remoteParticipantId
          )
      }

      let state =
        peerStatesRef.current.get(
          remoteParticipantId
        )

      if (!state) {
        state = {
          makingOffer: false,
          ignoreOffer: false,
        }

        peerStatesRef.current.set(
          remoteParticipantId,
          state
        )
      }

      if (
        state.makingOffer ||
        peer.signalingState !==
          "stable"
      ) {
        return
      }

      state.makingOffer = true

      try {
        const offer =
          await peer.createOffer()

        if (
          peer.signalingState !==
          "stable"
        ) {
          return
        }

        await peer.setLocalDescription(
          offer
        )

        if (
          !peer.localDescription ||
          peer.localDescription.type !==
            "offer"
        ) {
          return
        }

        publish(
          "/app/webrtc/offer",
          {
            roomId,
            participantId:
              participantIdRef.current,
            targetParticipantId:
              remoteParticipantId,
            offer:
              peer.localDescription,
          }
        )
      } catch {
        closePeer(
          remoteParticipantId
        )
      } finally {
        state.makingOffer = false
      }
    },
    [
      closePeer,
      createPeer,
      publish,
      roomId,
    ]
  )

  /* =======================================================
     REACTION DISPLAY
     ======================================================= */

  const triggerReactionDisplay =
    useCallback(
      (
        participantId: string,
        emoji: string
      ) => {
        if (!participantId || !emoji) {
          return
        }

        /*
         * Cancel only this participant's previous reaction timer.
         * Other participants' reactions remain independent.
         */
        const existingTimer =
          reactionTimersRef.current.get(
            participantId
          )

        if (existingTimer) {
          clearTimeout(existingTimer)
        }

        setParticipants((current) =>
          current.map(
            (participant) =>
              participant.id ===
              participantId
                ? {
                    ...participant,
                    reaction: emoji,
                  }
                : participant
          )
        )

        const timer =
          setTimeout(() => {
            setParticipants((current) =>
              current.map(
                (participant) =>
                  participant.id ===
                  participantId
                    ? {
                        ...participant,
                        reaction: null,
                      }
                    : participant
              )
            )

            reactionTimersRef.current.delete(
              participantId
            )
          }, 3500)

        reactionTimersRef.current.set(
          participantId,
          timer
        )
      },
      []
    )

  /* =======================================================
     SIGNALING
     ======================================================= */

  const signal = useCallback(
    async (raw: IMessage) => {
      try {
        const parsed =
          JSON.parse(raw.body) as Signal

        const type = (
          parsed.type ||
          parsed.event ||
          ""
        ).toUpperCase()

        const data =
          parsed.data || parsed

        /* ===================================================
           SESSION REPLACED
           =================================================== */

        if (
          type ===
          "PARTICIPANT_SESSION_REPLACED"
        ) {
          const replacedParticipantId =
            data.participantId

          const activeConnectionId =
            data.connectionId

          /*
           * The new tab receives this event too. Only the tab whose
           * connectionId differs from the active connection must shut
           * itself down.
           */
          if (
            replacedParticipantId ===
              participantIdRef.current &&
            activeConnectionId &&
            activeConnectionId !==
              connectionIdRef.current
          ) {
            setSessionReplaced(true)
            setStatus("offline")
            setJoinPhase("idle")
            setJoined(false)

            if (slowNoticeTimerRef.current) {
              clearTimeout(
                slowNoticeTimerRef.current
              )
              slowNoticeTimerRef.current = null
            }

            reactionTimersRef.current.forEach(
              (timer) => clearTimeout(timer)
            )
            reactionTimersRef.current.clear()

            subscriptionsRef.current.forEach(
              (subscription) => {
                try {
                  subscription.unsubscribe()
                } catch {
                  // Ignore cleanup errors.
                }
              }
            )
            subscriptionsRef.current = []

            peerConnectionsRef.current.forEach(
              (_, id) => closePeer(id)
            )
            peerConnectionsRef.current.clear()
            peerStatesRef.current.clear()
            pendingIceCandidatesRef.current.clear()

            remoteVideoRefs.current.forEach(
              (video) => {
                video.srcObject = null
              }
            )
            remoteVideoRefs.current.clear()

            screenStreamRef.current
              ?.getTracks()
              .forEach((track) => track.stop())
            screenStreamRef.current = null

            localStreamRef.current
              ?.getTracks()
              .forEach((track) => track.stop())
            localStreamRef.current = null

            if (localVideoElementRef.current) {
              localVideoElementRef.current.srcObject = null
            }

            const replacedClient = clientRef.current
            clientRef.current = null

            if (replacedClient) {
              void replacedClient.deactivate().catch(() => {})
            }

            joiningRef.current = false
            leavingRef.current = false
            establishedConnectionRef.current = false

            return
          }

          return
        }

        /* ===================================================
           ROOM STATE
           =================================================== */

        if (
          type === "ROOM_STATE" ||
          type === "ROOMSTATE"
        ) {
          const roomParticipants =
            data.participants || []

          const normalized =
            normalizeParticipants(
              roomParticipants
            )

          setParticipants(
            (current) =>
              normalized.map(
                (participant) => {
                  const existing =
                    current.find(
                      (item) =>
                        item.id ===
                        participant.id
                    )

                  return {
                    ...participant,
                    stream:
                      existing?.stream,
                    /*
                     * ROOM_STATE is authoritative for participant
                     * state. If the backend includes reaction, use it.
                     * If reaction is omitted by the backend, preserve the
                     * currently displayed transient reaction instead of
                     * resetting it because another participant joined/left.
                     */
                    reaction:
                      participant.reaction !==
                      undefined
                        ? participant.reaction
                        : existing?.reaction,
                  }
                }
              )
          )

          const local =
            normalized.find(
              (participant) =>
                participant.id ===
                participantIdRef.current
            )

          if (local) {
            setMicOn(!local.muted)
            setCameraOn(
              !local.cameraOff
            )
            setHandRaised(
              local.handRaised
            )
            setIsScreenSharing(
              local.screenSharing
            )
          }

          establishedConnectionRef.current =
            true

          setJoinPhase("ready")

          if (
            slowNoticeTimerRef.current
          ) {
            clearTimeout(
              slowNoticeTimerRef.current
            )
          }

          setSlowServerNotice(false)

          for (const participant of normalized) {
            if (
              participant.id ===
              participantIdRef.current
            ) {
              continue
            }

            if (
              participantIdRef.current <
              participant.id
            ) {
              await createOffer(
                participant.id
              )
            }
          }

          return
        }

        /* ===================================================
           PARTICIPANT JOINED
           =================================================== */

        if (
          type ===
            "PARTICIPANT_JOINED" ||
          type === "JOIN" ||
          type ===
            "PARTICIPANT-JOINED"
        ) {
          const remoteId =
            data.participantId

          if (
            !remoteId ||
            remoteId ===
              participantIdRef.current
          ) {
            return
          }

          /*
           * ROOM_STATE is the authoritative participant snapshot.
           *
           * Do NOT create a participant here with default values such as
           * muted=false, cameraOff=false, handRaised=false, etc.
           * PARTICIPANT_JOINED may arrive before/around ROOM_STATE and
           * those defaults can overwrite the real backend state visually.
           *
           * We only use the join event to start WebRTC negotiation.
           * The participant card/state is rendered from ROOM_STATE.
           */
          await createOffer(
            remoteId
          )

          return
        }

        /* ===================================================
           PARTICIPANT LEFT
           =================================================== */

        if (
          type ===
            "PARTICIPANT_LEFT" ||
          type ===
            "PARTICIPANT_LEFT_EVENT" ||
          type === "LEAVE" ||
          type ===
            "PARTICIPANT-LEFT" ||
          type ===
            "PARTICIPANT_LEFT_ROOM"
        ) {
          const remoteId =
            data.participantId

          if (
            remoteId &&
            remoteId !==
              participantIdRef.current
          ) {
            removeParticipant(
              remoteId
            )
          }

          return
        }

        /* ===================================================
           MEDIA STATUS
           =================================================== */

        if (
          type ===
            "MEDIA_STATUS_UPDATE" ||
          type ===
            "MEDIA_STATUS"
        ) {
          const targetId =
            data.participantId

          if (!targetId) {
            return
          }

          setParticipants((current) =>
            current.map(
              (participant) =>
                participant.id ===
                targetId
                  ? {
                      ...participant,

                      muted:
                        data.muted !==
                        undefined
                          ? data.muted
                          : participant.muted,

                      cameraOff:
                        data.cameraOff !==
                        undefined
                          ? data.cameraOff
                          : participant.cameraOff,
                    }
                  : participant
            )
          )

          if (
            targetId ===
            participantIdRef.current
          ) {
            if (
              data.muted !==
              undefined
            ) {
              setMicOn(!data.muted)
            }

            if (
              data.cameraOff !==
              undefined
            ) {
              setCameraOn(
                !data.cameraOff
              )
            }
          }

          return
        }

        /* ===================================================
           HAND RAISE
           =================================================== */

        if (
          type ===
            "HAND_RAISE_TOGGLE" ||
          type ===
            "HAND_RAISE"
        ) {
          const targetId =
            data.participantId

          if (!targetId) {
            return
          }

          setParticipants((current) =>
            current.map(
              (participant) =>
                participant.id ===
                targetId
                  ? {
                      ...participant,
                      handRaised:
                        data.handRaised ??
                        false,
                    }
                  : participant
            )
          )

          if (
            targetId ===
            participantIdRef.current
          ) {
            setHandRaised(
              data.handRaised ??
                false
            )
          }

          return
        }

        /* ===================================================
           SCREEN SHARE
           =================================================== */

        if (
          type ===
            "SCREEN_SHARE_STATUS" ||
          type ===
            "SCREEN_SHARE"
        ) {
          const targetId =
            data.participantId

          if (!targetId) {
            return
          }

          setParticipants((current) =>
            current.map(
              (participant) =>
                participant.id ===
                targetId
                  ? {
                      ...participant,
                      screenSharing:
                        data.screenSharing ??
                        false,
                    }
                  : participant
            )
          )

          if (
            targetId ===
            participantIdRef.current
          ) {
            setIsScreenSharing(
              data.screenSharing ??
                false
            )
          }

          return
        }

        /* ===================================================
           REACTION
           =================================================== */

        if (
          type === "REACTION"
        ) {
          if (
            data.participantId &&
            data.emoji
          ) {
            triggerReactionDisplay(
              data.participantId,
              data.emoji
            )
          }

          return
        }

        /* ===================================================
           JOIN REJECTED
           =================================================== */

        if (
          type ===
          "JOIN_REJECTED"
        ) {
          setJoinError(
            data.message ||
              "You are already participating in this meeting."
          )

          setJoined(false)
          setJoinPhase("error")

          joiningRef.current =
            false

          if (
            slowNoticeTimerRef.current
          ) {
            clearTimeout(
              slowNoticeTimerRef.current
            )
          }

          return
        }

        /* ===================================================
           CHAT
           =================================================== */

        if (
          type ===
            "CHAT_MESSAGE" ||
          type === "CHAT" ||
          type === "MESSAGE"
        ) {
          const text =
            data.message ||
            data.text ||
            ""

          if (!text) {
            return
          }

          setMessages((current) => [
            ...current,
            {
              id:
                crypto.randomUUID(),
              participantId:
                data.participantId ||
                "",
              name:
                data.name ||
                "Guest",
              text,
              time:
                new Date().toLocaleTimeString(
                  [],
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                  }
                ),
            },
          ])

          return
        }

        /* ===================================================
           WEBRTC OFFER
           =================================================== */

        if (
          type ===
            "WEBRTC_OFFER" ||
          type === "OFFER"
        ) {
          const remoteParticipantId =
            data.participantId

          const targetParticipantId =
            data.targetParticipantId

          const offer =
            data.offer

          if (
            !remoteParticipantId ||
            remoteParticipantId ===
              participantIdRef.current ||
            !offer
          ) {
            return
          }

          if (
            targetParticipantId &&
            targetParticipantId !==
              participantIdRef.current
          ) {
            return
          }

          const peer =
            createPeer(
              remoteParticipantId
            )

          let state =
            peerStatesRef.current.get(
              remoteParticipantId
            )

          if (!state) {
            state = {
              makingOffer: false,
              ignoreOffer: false,
            }

            peerStatesRef.current.set(
              remoteParticipantId,
              state
            )
          }

          const offerCollision =
            state.makingOffer ||
            peer.signalingState !==
              "stable"

          const polite =
            participantIdRef.current >
            remoteParticipantId

          state.ignoreOffer =
            !polite &&
            offerCollision

          if (state.ignoreOffer) {
            return
          }

          try {
            if (
              offerCollision &&
              polite
            ) {
              await peer.setLocalDescription(
                {
                  type: "rollback",
                }
              )
            }

            if (
              peer.signalingState !==
              "stable"
            ) {
              return
            }

            await peer.setRemoteDescription(
              offer
            )

            await applyPendingIce(
              remoteParticipantId,
              peer
            )

            const answer =
              await peer.createAnswer()

            await peer.setLocalDescription(
              answer
            )

            if (
              !peer.localDescription ||
              peer.localDescription.type !==
                "answer"
            ) {
              return
            }

            publish(
              "/app/webrtc/answer",
              {
                roomId,
                participantId:
                  participantIdRef.current,
                targetParticipantId:
                  remoteParticipantId,
                answer:
                  peer.localDescription,
              }
            )
          } catch {
            closePeer(
              remoteParticipantId
            )
          } finally {
            state.makingOffer =
              false
          }

          return
        }

        /* ===================================================
           WEBRTC ANSWER
           =================================================== */

        if (
          type ===
            "WEBRTC_ANSWER" ||
          type === "ANSWER"
        ) {
          const remoteParticipantId =
            data.participantId

          const targetParticipantId =
            data.targetParticipantId

          const answer =
            data.answer

          if (
            !remoteParticipantId ||
            remoteParticipantId ===
              participantIdRef.current ||
            !answer
          ) {
            return
          }

          if (
            targetParticipantId &&
            targetParticipantId !==
              participantIdRef.current
          ) {
            return
          }

          const peer =
            peerConnectionsRef.current.get(
              remoteParticipantId
            )

          if (
            !peer ||
            peer.signalingState !==
              "have-local-offer"
          ) {
            return
          }

          try {
            await peer.setRemoteDescription(
              answer
            )

            await applyPendingIce(
              remoteParticipantId,
              peer
            )
          } catch {
            // Ignore invalid answer.
          }

          return
        }

        /* ===================================================
           WEBRTC ICE
           =================================================== */

        if (
          type === "WEBRTC_ICE" ||
          type === "ICE" ||
          type === "CANDIDATE"
        ) {
          const remoteParticipantId =
            data.participantId

          const targetParticipantId =
            data.targetParticipantId

          const candidate =
            data.candidate

          if (
            !remoteParticipantId ||
            remoteParticipantId ===
              participantIdRef.current ||
            !candidate
          ) {
            return
          }

          if (
            targetParticipantId &&
            targetParticipantId !==
              participantIdRef.current
          ) {
            return
          }

          const peer =
            peerConnectionsRef.current.get(
              remoteParticipantId
            )

          if (
            !peer ||
            !peer.remoteDescription
          ) {
            const pending =
              pendingIceCandidatesRef.current.get(
                remoteParticipantId
              ) || []

            pending.push(candidate)

            pendingIceCandidatesRef.current.set(
              remoteParticipantId,
              pending
            )

            return
          }

          try {
            await peer.addIceCandidate(
              candidate
            )
          } catch {
            const state =
              peerStatesRef.current.get(
                remoteParticipantId
              )

            if (!state?.ignoreOffer) {
              // Ignore invalid ICE.
            }
          }

          return
        }
      } catch {
        // Ignore malformed STOMP messages.
      }
    },
    [
      applyPendingIce,
      closePeer,
      createOffer,
      createPeer,
      normalizeParticipants,
      publish,
      removeParticipant,
      roomId,
      triggerReactionDisplay,
    ]
  )

  /* =======================================================
     JOIN
     ======================================================= */

  const join = useCallback(
    async () => {
      if (
        joiningRef.current ||
        joined
      ) {
        return
      }

      joiningRef.current = true
      leavingRef.current = false
      setSessionReplaced(false)

      setJoinError(null)
      setSlowServerNotice(false)
      setJoinPhase(
        "requesting_media"
      )

      slowNoticeTimerRef.current =
        setTimeout(() => {
          if (mountedRef.current) {
            setSlowServerNotice(true)
          }
        }, 6000)

      try {
        if (!participantIdRef.current) {
          const storedParticipantId =
            localStorage.getItem(
              participantStorageKey
            )

          participantIdRef.current =
            storedParticipantId ||
            crypto.randomUUID()

          localStorage.setItem(
            participantStorageKey,
            participantIdRef.current
          )
        }

        const displayName =
          name.trim() || "Guest"

        nameRef.current =
          displayName

        sessionStorage.setItem(
          "mymeet-name",
          displayName
        )

        setName(displayName)
        setStatus("connecting")

        const stream =
          await getLocalMedia()

        if (!stream) {
          setMediaWarning(
            "You joined without camera/microphone. You can still view/listen."
          )
        }

        /*
         * Do not create a local participant from local media defaults.
         * The backend ROOM_STATE is the source of truth for participant
         * state (mic, camera, hand raise, screen share and reaction).
         *
         * Keeping the participant list untouched here also prevents a
         * reconnect/join from temporarily replacing authoritative state
         * with client-side defaults.
         */
        setJoined(true)

        setJoinPhase(
          "connecting_ws"
        )

        const backendWsUrl =
          getBackendWsUrl()

        const client =
          new Client({
            brokerURL:
              backendWsUrl,

            reconnectDelay: 5000,

            onConnect: () => {
              if (
                leavingRef.current
              ) {
                return
              }

              const reconnecting =
                establishedConnectionRef.current

              setStatus("connected")

              /*
               * During a reconnect, keep the existing meeting
               * UI visible. The ROOM_STATE below will refresh
               * authoritative participant state.
               *
               * Only the initial connection uses the
               * initialization overlay.
               */
              if (!reconnecting) {
                setJoinPhase(
                  "subscribing"
                )
              }

              const subscription =
                client.subscribe(
                  `/topic/meet/${roomId}`,
                  signal
                )

              subscriptionsRef.current = [
                subscription,
              ]

              if (!reconnecting) {
                setJoinPhase(
                  "joining_room"
                )
              }

              /*
               * Read the actual current track state here.
               * Do not reuse initialMicOn/initialCameraOn because
               * the user may have toggled media before a reconnect.
               */
              const currentMicOn =
                localStreamRef.current
                  ?.getAudioTracks()
                  .some(
                    (track) =>
                      track.readyState ===
                        "live" &&
                      track.enabled
                  ) ?? false

              const currentCameraOn =
                localStreamRef.current
                  ?.getVideoTracks()
                  .some(
                    (track) =>
                      track.readyState ===
                        "live" &&
                      track.enabled
                  ) ?? false

              const joinPayload = {
                roomId,
                participantId:
                  participantIdRef.current,
                connectionId:
                  connectionIdRef.current,
                name:
                  nameRef.current,
                muted:
                  !currentMicOn,
                cameraOff:
                  !currentCameraOn,
              }

              client.publish({
                destination:
                  "/app/meet/join",
                body:
                  JSON.stringify(
                    joinPayload
                  ),
              })

              if (!reconnecting) {
                setJoinPhase(
                  "waiting_room_state"
                )
              }
            },

            onStompError: () => {
              if (
                mountedRef.current &&
                !leavingRef.current
              ) {
                setStatus("offline")

                /*
                 * Once the meeting has been established, do not
                 * destroy the meeting UI for a temporary STOMP
                 * failure. The STOMP client will reconnect.
                 */
                if (
                  !establishedConnectionRef.current
                ) {
                  setJoinError(
                    "Unable to connect to the meeting server."
                  )

                  setJoinPhase(
                    "error"
                  )

                  joiningRef.current =
                    false

                  if (
                    slowNoticeTimerRef.current
                  ) {
                    clearTimeout(
                      slowNoticeTimerRef.current
                    )
                  }
                }
              }
            },

            onWebSocketError: () => {
              if (
                mountedRef.current &&
                !leavingRef.current
              ) {
                setStatus("offline")

                if (
                  !establishedConnectionRef.current
                ) {
                  setJoinError(
                    "WebSocket connection failed."
                  )

                  setJoinPhase(
                    "error"
                  )

                  joiningRef.current =
                    false
                }
              }
            },

            onWebSocketClose: () => {
              if (
                mountedRef.current &&
                !leavingRef.current
              ) {
                setStatus("offline")
              }
            },
          })

        clientRef.current =
          client

        client.activate()
      } catch {
        setJoinError(
          "An unexpected error occurred while joining."
        )

        setJoinPhase("error")

        joiningRef.current =
          false

        if (
          slowNoticeTimerRef.current
        ) {
          clearTimeout(
            slowNoticeTimerRef.current
          )
        }
      }
    },
    [
      getLocalMedia,
      joined,
      name,
      participantStorageKey,
      roomId,
      signal,
    ]
  )

  /* =======================================================
     CLEANUP
     ======================================================= */

  const cleanup = useCallback(
    async () => {
      if (leavingRef.current) {
        return
      }

      leavingRef.current = true
      setIsLeaving(true)

      if (
        slowNoticeTimerRef.current
      ) {
        clearTimeout(
          slowNoticeTimerRef.current
        )
      }

      reactionTimersRef.current.forEach(
        (timer) => clearTimeout(timer)
      )

      reactionTimersRef.current.clear()

      const client =
        clientRef.current

      if (
        client &&
        client.connected
      ) {
        try {
          client.publish({
            destination:
              "/app/meet/leave",

            body:
              JSON.stringify({
                roomId,
                participantId:
                  participantIdRef.current,
                name:
                  nameRef.current,
              }),
          })

          /*
           * Give the broker/server a short window
           * to process the leave message before
           * closing the STOMP connection.
           */
          await new Promise<void>(
            (resolve) =>
              setTimeout(
                resolve,
                150
              )
          )
        } catch {
          // Continue cleanup even if leave publish fails.
        }
      }

      subscriptionsRef.current.forEach(
        (subscription) => {
          try {
            subscription.unsubscribe()
          } catch {
            // Ignore subscription cleanup errors.
          }
        }
      )

      subscriptionsRef.current = []

      peerConnectionsRef.current.forEach(
        (_, id) => {
          closePeer(id)
        }
      )

      peerConnectionsRef.current.clear()
      peerStatesRef.current.clear()
      pendingIceCandidatesRef.current.clear()

      remoteVideoRefs.current.forEach(
        (video) => {
          video.srcObject = null
        }
      )

      remoteVideoRefs.current.clear()

      if (
        screenStreamRef.current
      ) {
        screenStreamRef.current
          .getTracks()
          .forEach((track) =>
            track.stop()
          )

        screenStreamRef.current =
          null
      }

      if (
        localStreamRef.current
      ) {
        localStreamRef.current
          .getTracks()
          .forEach((track) =>
            track.stop()
          )

        localStreamRef.current =
          null
      }

      if (
        localVideoElementRef.current
      ) {
        localVideoElementRef.current.srcObject =
          null
      }

      if (client) {
        try {
          await client.deactivate()
        } catch {
          // Ignore client cleanup errors.
        }
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
      setIsScreenSharing(false)
      setHandRaised(false)
      setMicOn(true)
      setCameraOn(true)

      joiningRef.current = false
      leavingRef.current = false
      establishedConnectionRef.current =
        false
    },
    [
      closePeer,
      roomId,
    ]
  )

  const leaveMeeting =
    useCallback(async () => {
      await cleanup()
    }, [cleanup])

  /* =======================================================
     COMPONENT CLEANUP
     ======================================================= */

  useEffect(() => {
    return () => {
      reactionTimersRef.current.forEach(
        (timer) => clearTimeout(timer)
      )

      reactionTimersRef.current.clear()

      screenStreamRef.current
        ?.getTracks()
        .forEach((track) =>
          track.stop()
        )

      localStreamRef.current
        ?.getTracks()
        .forEach((track) =>
          track.stop()
        )

      peerConnectionsRef.current.forEach(
        (peer) => {
          try {
            peer.close()
          } catch {
            // Ignore.
          }
        }
      )

      subscriptionsRef.current.forEach(
        (subscription) => {
          try {
            subscription.unsubscribe()
          } catch {
            // Ignore.
          }
        }
      )

      if (clientRef.current) {
        clientRef.current
          .deactivate()
          .catch(() => {})
      }
    }
  }, [])

  /* =======================================================
     COPY URL
     ======================================================= */

  const copyMeetUrl =
    useCallback(() => {
      if (
        typeof window !==
        "undefined"
      ) {
        void navigator.clipboard.writeText(
          window.location.href
        )

        setCopiedUrl(true)

        setTimeout(
          () =>
            setCopiedUrl(false),
          2000
        )
      }
    }, [])

  /* =======================================================
     CHAT
     ======================================================= */

  const sendMessage =
    useCallback(
      (
        event?: FormEvent
      ) => {
        event?.preventDefault()

        if (sessionReplaced) {
          return
        }

        const text =
          draft.trim()

        if (!text) {
          return
        }

        const sent = publish(
          "/app/meet/message",
          {
            roomId,
            participantId:
              participantIdRef.current,
            name:
              nameRef.current,
            message: text,
          }
        )

        if (sent) {
          setDraft("")
        }
      },
      [
        draft,
        publish,
        roomId,
        sessionReplaced,
      ]
    )

  /* =======================================================
     MICROPHONE
     ======================================================= */

  const toggleMic =
    useCallback(() => {
      if (sessionReplaced) {
        return
      }

      const stream =
        localStreamRef.current

      const next = !micOn

      if (stream) {
        stream
          .getAudioTracks()
          .forEach(
            (track) => {
              track.enabled =
                next
            }
          )
      }

      setMicOn(next)

      setParticipants(
        (current) =>
          current.map(
            (participant) =>
              participant.id ===
              participantIdRef.current
                ? {
                    ...participant,
                    muted:
                      !next,
                  }
                : participant
          )
      )

      publish(
        "/app/meet/media-status",
        {
          roomId,
          participantId:
            participantIdRef.current,
          muted: !next,
          cameraOff:
            !cameraOn,
        }
      )
    }, [
      cameraOn,
      micOn,
      publish,
      roomId,
      sessionReplaced,
    ])

  /* =======================================================
     CAMERA
     ======================================================= */

  const toggleCamera =
    useCallback(() => {
      if (sessionReplaced) {
        return
      }

      const stream =
        localStreamRef.current

      const next = !cameraOn

      if (stream) {
        stream
          .getVideoTracks()
          .forEach(
            (track) => {
              track.enabled =
                next
            }
          )
      }

      setCameraOn(next)

      setParticipants(
        (current) =>
          current.map(
            (participant) =>
              participant.id ===
              participantIdRef.current
                ? {
                    ...participant,
                    cameraOff:
                      !next,
                  }
                : participant
          )
      )

      publish(
        "/app/meet/media-status",
        {
          roomId,
          participantId:
            participantIdRef.current,
          muted: !micOn,
          cameraOff: !next,
        }
      )
    }, [
      cameraOn,
      micOn,
      publish,
      roomId,
      sessionReplaced,
    ])

  /* =======================================================
     SCREEN SHARE
     ======================================================= */

  const toggleScreenShare =
    useCallback(async () => {
      if (sessionReplaced) {
        return
      }

      if (isScreenSharing) {
        if (
          screenStreamRef.current
        ) {
          screenStreamRef.current
            .getTracks()
            .forEach((track) =>
              track.stop()
            )

          screenStreamRef.current =
            null
        }

        const cameraTrack =
          localStreamRef.current
            ?.getVideoTracks()[0]

        peerConnectionsRef.current.forEach(
          (peer) => {
            const sender =
              peer
                .getSenders()
                .find(
                  (item) =>
                    item.track
                      ?.kind ===
                    "video"
                )

            if (sender) {
              void sender.replaceTrack(
                cameraTrack ||
                  null
              )
            }
          }
        )

        setIsScreenSharing(false)

        setParticipants(
          (current) =>
            current.map(
              (participant) =>
                participant.id ===
                participantIdRef.current
                  ? {
                      ...participant,
                      screenSharing:
                        false,
                    }
                  : participant
            )
        )

        publish(
          "/app/meet/screen-share",
          {
            roomId,
            participantId:
              participantIdRef.current,
            screenSharing:
              false,
          }
        )

        bindLocalVideo()

        return
      }

      try {
        const displayStream =
          await navigator.mediaDevices.getDisplayMedia(
            {
              video: true,
            }
          )

        screenStreamRef.current =
          displayStream

        const screenTrack =
          displayStream.getVideoTracks()[0]

        peerConnectionsRef.current.forEach(
          (peer) => {
            const sender =
              peer
                .getSenders()
                .find(
                  (item) =>
                    item.track
                      ?.kind ===
                    "video"
                )

            if (sender) {
              void sender.replaceTrack(
                screenTrack
              )
            }
          }
        )

        setIsScreenSharing(true)

        setParticipants(
          (current) =>
            current.map(
              (participant) =>
                participant.id ===
                participantIdRef.current
                  ? {
                      ...participant,
                      screenSharing:
                        true,
                    }
                  : participant
            )
        )

        publish(
          "/app/meet/screen-share",
          {
            roomId,
            participantId:
              participantIdRef.current,
            screenSharing:
              true,
          }
        )

        bindLocalVideo()

        screenTrack.onended =
          () => {
            if (
              screenStreamRef.current
            ) {
              screenStreamRef.current
                .getTracks()
                .forEach(
                  (track) =>
                    track.stop()
                )

              screenStreamRef.current =
                null
            }

            const cameraTrack =
              localStreamRef.current
                ?.getVideoTracks()[0]

            peerConnectionsRef.current.forEach(
              (peer) => {
                const sender =
                  peer
                    .getSenders()
                    .find(
                      (item) =>
                        item.track
                          ?.kind ===
                        "video"
                    )

                if (sender) {
                  void sender.replaceTrack(
                    cameraTrack ||
                      null
                  )
                }
              }
            )

            setIsScreenSharing(
              false
            )

            setParticipants(
              (current) =>
                current.map(
                  (participant) =>
                    participant.id ===
                    participantIdRef.current
                      ? {
                          ...participant,
                          screenSharing:
                            false,
                        }
                      : participant
                )
            )

            publish(
              "/app/meet/screen-share",
              {
                roomId,
                participantId:
                  participantIdRef.current,
                screenSharing:
                  false,
              }
            )

            bindLocalVideo()
          }
      } catch {
        // User canceled or browser blocked screen sharing.
      }
    },
    [
      bindLocalVideo,
      isScreenSharing,
      publish,
      roomId,
      sessionReplaced,
    ])

  /* =======================================================
     HAND RAISE
     ======================================================= */

  const toggleHandRaise =
    useCallback(() => {
      if (sessionReplaced) {
        return
      }

      const nextState =
        !handRaised

      setHandRaised(
        nextState
      )

      setParticipants(
        (current) =>
          current.map(
            (participant) =>
              participant.id ===
              participantIdRef.current
                ? {
                    ...participant,
                    handRaised:
                      nextState,
                  }
                : participant
          )
      )

      publish(
        "/app/meet/hand-raise",
        {
          roomId,
          participantId:
            participantIdRef.current,
          handRaised:
            nextState,
        }
      )
    }, [
      handRaised,
      publish,
      roomId,
      sessionReplaced,
    ])

  /* =======================================================
     REACTION
     ======================================================= */

  const sendReaction =
    useCallback(
      (emoji: string) => {
        if (sessionReplaced) {
          return
        }

        setShowReactions(false)

        triggerReactionDisplay(
          participantIdRef.current,
          emoji
        )

        publish(
          "/app/meet/reaction",
          {
            roomId,
            participantId:
              participantIdRef.current,
            emoji,
          }
        )
      },
      [
        publish,
        roomId,
        triggerReactionDisplay,
        sessionReplaced,
      ]
    )

  /* =======================================================
     REMOTE VIDEO REF
     ======================================================= */

  const setRemoteVideoRef =
    useCallback(
      (
        participantId: string,
        element: HTMLVideoElement | null
      ) => {
        if (!element) {
          remoteVideoRefs.current.delete(
            participantId
          )

          return
        }

        remoteVideoRefs.current.set(
          participantId,
          element
        )

        const participant =
          participants.find(
            (item) =>
              item.id ===
              participantId
          )

        if (
          participant?.stream &&
          element.srcObject !==
            participant.stream
        ) {
          element.srcObject =
            participant.stream

          void element
            .play()
            .catch(() => {})
        }
      },
      [participants]
    )

  /* =======================================================
     UNIQUE PARTICIPANTS
     ======================================================= */

  const uniqueParticipants =
    Array.from(
      new Map(
        participants.map(
          (participant) => [
            participant.id,
            participant,
          ]
        )
      ).values()
    )

  /* =======================================================
     GRID
     ======================================================= */

  const getGridClass =
    (count: number) => {
      if (count <= 1) {
        return "grid-cols-1 max-w-4xl"
      }

      if (count === 2) {
        return "grid-cols-1 sm:grid-cols-2 max-w-5xl"
      }

      if (count <= 4) {
        return "grid-cols-2 max-w-6xl"
      }

      if (count <= 6) {
        return "grid-cols-2 md:grid-cols-3 max-w-7xl"
      }

      if (count <= 9) {
        return "grid-cols-3 md:grid-cols-3 max-w-7xl"
      }

      return "grid-cols-2 md:grid-cols-4 max-w-full"
    }

  /* =======================================================
     JOIN SCREEN
     ======================================================= */

  const isJoiningPending =
    joinPhase !== "idle" &&
    joinPhase !== "ready" &&
    joinPhase !== "error"

  if (!joined) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#181d1b] px-4 py-6 text-[#f0f3f1]">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#222a27] p-6 sm:p-8 shadow-2xl">
          <div className="mb-6 sm:mb-8 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-2xl bg-[#e76f51] text-white shadow-lg shadow-[#e76f51]/20">
                <Video size={20} />
              </span>

              <span className="text-xl font-bold tracking-wide">
                MyMeet
              </span>
            </div>

            <Link
              href="/"
              className="text-xs font-medium text-[#a0aba6] transition-colors hover:text-white"
            >
              Back to Home
            </Link>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wider text-[#a0aba6]">
            You&apos;re joining
          </p>

          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">
            {roomId}
          </h1>

          <label className="mt-6 block text-sm font-medium text-[#d0d7d4]">
            Your Name

            <input
              value={name}
              disabled={
                isJoiningPending
              }
              onChange={(event) =>
                setName(
                  event.target.value
                )
              }
              onKeyDown={(event) => {
                if (
                  event.key ===
                    "Enter" &&
                  !isJoiningPending
                ) {
                  void join()
                }
              }}
              placeholder="e.g. Nora Patel"
              className="mt-2 w-full rounded-xl border border-white/10 bg-[#181d1b] px-4 py-3 text-white outline-none transition-all placeholder:text-[#606b66] focus:border-[#e76f51] focus:ring-1 focus:ring-[#e76f51] disabled:opacity-50"
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
                You can still join
                without audio/video
                capabilities.
              </p>
            </div>
          )}

          <button
            onClick={() =>
              void join()
            }
            disabled={
              isJoiningPending
            }
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#e76f51] px-4 text-sm font-semibold text-white shadow-lg shadow-[#e76f51]/25 transition-all hover:bg-[#d05d41] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-75"
          >
            {isJoiningPending ? (
              <>
                <Loader2
                  size={16}
                  className="animate-spin"
                />

                <span>
                  Joining...
                </span>
              </>
            ) : (
              <>
                <span>
                  Join Meeting
                </span>

                <Link2
                  size={16}
                />
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
     MEETING STATE
     ======================================================= */

  const pinnedParticipant =
    uniqueParticipants.find(
      (participant) =>
        participant.id ===
        pinnedParticipantId
    )

  const unpinnedParticipants =
    uniqueParticipants.filter(
      (participant) =>
        participant.id !==
        pinnedParticipantId
    )

  const isInitializing =
    joinPhase !== "ready"

  const getJoinPhaseLabel =
    (phase: JoinPhase) => {
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

  /* =======================================================
     MEETING UI
     ======================================================= */

  return (
    <main className="relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#121615] text-[#f0f3f1]">
      {/* ===================================================
          INITIALIZATION OVERLAY
          =================================================== */}

      {isInitializing && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#121615]/95 p-4 text-center backdrop-blur-md">
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-white/10 bg-[#181d1b] p-8 shadow-2xl">
            <Loader2
              size={36}
              className="animate-spin text-[#e76f51]"
            />

            <div>
              <p className="text-base font-semibold text-white">
                {getJoinPhaseLabel(
                  joinPhase
                )}
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

      {sessionReplaced && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#121615]/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#181d1b] p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-amber-500/15 text-amber-400">
              <Video size={22} />
            </div>
            <h2 className="text-base font-semibold text-white">
              Meeting opened in another tab
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#9aa59f]">
              This tab is no longer the active meeting session. Your camera and microphone have been released.
            </p>
            <p className="mt-3 text-xs text-[#68736e]">
              Use the other tab to continue the meeting.
            </p>
          </div>
        </div>
      )}

      {/* ===================================================
          HEADER
          =================================================== */}

      <header className="flex h-14 sm:h-16 shrink-0 items-center justify-between border-b border-white/5 bg-[#181d1b] px-3 sm:px-4 lg:px-6">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <span className="grid size-8 sm:size-9 shrink-0 place-items-center rounded-xl bg-[#e76f51] text-white">
            <Video size={16} className="sm:hidden" />
            <Video size={18} className="hidden sm:block" />
          </span>

          <div className="min-w-0">
            <p className="truncate text-xs sm:text-sm font-semibold leading-tight text-white">
              {roomId}
            </p>

            <p className="text-[10px] sm:text-[11px] text-[#828e88]">
              {uniqueParticipants.length}{" "}
              participant
              {uniqueParticipants.length !==
              1
                ? "s"
                : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={
              copyMeetUrl
            }
            className="flex h-8 sm:h-9 items-center gap-1.5 rounded-xl bg-white/5 px-2.5 sm:px-3 text-xs font-medium text-[#a0aba6] transition-colors hover:bg-white/10 hover:text-white"
            title="Copy Meeting Link"
          >
            {copiedUrl ? (
              <>
                <Check
                  size={14}
                  className="text-emerald-400"
                />

                <span className="text-emerald-400">
                  Copied!
                </span>
              </>
            ) : (
              <>
                <Copy size={14} />

                <span className="hidden sm:inline">
                  Copy Link
                </span>
              </>
            )}
          </button>

          <div
            className={`flex items-center gap-1.5 rounded-full border px-2.5 sm:px-3 py-1 text-xs font-medium ${
              status ===
              "connected"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/20 bg-amber-500/10 text-amber-400"
            }`}
          >
            {status ===
            "connected" ? (
              <Wifi size={12} />
            ) : (
              <WifiOff
                size={12}
              />
            )}

            <span className="hidden sm:inline">
              {status ===
              "connected"
                ? "Connected"
                : "Reconnecting"}
            </span>
          </div>

          <button
            onClick={() =>
              setChatOpen(
                (previous) =>
                  !previous
              )
            }
            className={`relative rounded-xl p-2 sm:p-2.5 transition-colors ${
              chatOpen
                ? "bg-[#e76f51] text-white"
                : "bg-white/5 text-[#a0aba6] hover:bg-white/10 hover:text-white"
            }`}
            aria-label="Toggle chat"
          >
            <MessageCircle
              size={18}
            />

            {messages.length >
              0 &&
              !chatOpen && (
                <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[#e76f51] ring-2 ring-[#181d1b]" />
              )}
          </button>
        </div>
      </header>

      {/* ===================================================
          MEDIA WARNING
          =================================================== */}

      {mediaWarning && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-300 shrink-0">
          {mediaWarning}
        </div>
      )}

      {/* ===================================================
          MAIN WORKSPACE
          =================================================== */}

      <div className="relative flex flex-1 min-h-0 w-full overflow-hidden p-2 sm:p-3 lg:p-4">
        {/* =================================================
            VIDEO CONTAINER
            ================================================= */}

        <div className="flex flex-1 flex-col items-center justify-center overflow-hidden h-full w-full">
          {pinnedParticipant ? (
            <div className="flex size-full flex-col gap-2 sm:gap-3 overflow-hidden lg:flex-row">
              <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/5 bg-[#1a201e]">
                <ParticipantCard
                  participant={
                    pinnedParticipant
                  }
                  isLocal={
                    pinnedParticipant.id ===
                    participantIdRef.current
                  }
                  setLocalVideoRef={
                    setLocalVideoRef
                  }
                  setRemoteVideoRef={
                    setRemoteVideoRef
                  }
                  isPinned
                  cameraOn={
                    cameraOn
                  }
                  micOn={micOn}
                  onUnpin={() =>
                    setPinnedParticipantId(
                      null
                    )
                  }
                />
              </div>

              <div className="flex shrink-0 gap-2 overflow-x-auto p-1 lg:w-64 lg:flex-col lg:overflow-y-auto">
                {unpinnedParticipants.map(
                  (participant) => (
                    <div
                      key={
                        participant.id
                      }
                      className="relative h-24 sm:h-28 w-36 sm:w-44 shrink-0 overflow-hidden rounded-xl border border-white/5 bg-[#1a201e] lg:h-36 lg:w-full"
                    >
                      <ParticipantCard
                        participant={
                          participant
                        }
                        isLocal={
                          participant.id ===
                          participantIdRef.current
                        }
                        setLocalVideoRef={
                          setLocalVideoRef
                        }
                        setRemoteVideoRef={
                          setRemoteVideoRef
                        }
                        cameraOn={
                          cameraOn
                        }
                        micOn={micOn}
                        onPin={() =>
                          setPinnedParticipantId(
                            participant.id
                          )
                        }
                      />
                    </div>
                  )
                )}
              </div>
            </div>
          ) : (
            <div className="flex size-full items-center justify-center overflow-y-auto p-1">
              <div
                className={`grid w-full gap-2 sm:gap-3 transition-all duration-300 auto-rows-fr ${getGridClass(
                  uniqueParticipants.length
                )}`}
              >
                {uniqueParticipants.map(
                  (
                    participant,
                    index
                  ) => (
                    <div
                      key={
                        participant.id
                      }
                      className="relative aspect-video min-h-[140px] sm:min-h-[160px] max-h-[75vh] w-full overflow-hidden rounded-xl sm:rounded-2xl border border-white/5 bg-[#1a201e] shadow-md"
                    >
                      <ParticipantCard
                        participant={
                          participant
                        }
                        isLocal={
                          participant.id ===
                          participantIdRef.current
                        }
                        setLocalVideoRef={
                          setLocalVideoRef
                        }
                        setRemoteVideoRef={
                          setRemoteVideoRef
                        }
                        bgColor={
                          colors[
                            index %
                              colors.length
                          ]
                        }
                        cameraOn={
                          cameraOn
                        }
                        micOn={micOn}
                        onPin={() =>
                          setPinnedParticipantId(
                            participant.id
                          )
                        }
                      />
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>

        {/* =================================================
            CHAT
            ================================================= */}

        {chatOpen && (
          <aside className="absolute inset-2 sm:inset-y-3 sm:right-3 z-30 flex w-[calc(100%-1rem)] sm:w-80 flex-col rounded-2xl border border-white/10 bg-[#181d1b] shadow-2xl lg:relative lg:inset-0">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/5 px-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#a0aba6]">
                In-Call Messages
              </h2>

              <button
                onClick={() =>
                  setChatOpen(
                    false
                  )
                }
                className="rounded-lg p-1 text-[#a0aba6] hover:bg-white/5 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">
              {messages.length ===
              0 ? (
                <div className="flex h-full items-center justify-center text-center text-[#606b66]">
                  No messages yet.
                  Send a message to
                  start chatting!
                </div>
              ) : (
                messages.map(
                  (message) => {
                    const isMe =
                      message.participantId ===
                      participantIdRef.current

                    return (
                      <div
                        key={
                          message.id
                        }
                        className={`flex flex-col ${
                          isMe
                            ? "items-end"
                            : "items-start"
                        }`}
                      >
                        <div className="mb-1 flex items-center gap-1.5 text-[10px] text-[#828e88]">
                          <span>
                            {isMe
                              ? "You"
                              : message.name}
                          </span>

                          <span>
                            •
                          </span>

                          <span>
                            {
                              message.time
                            }
                          </span>
                        </div>

                        <div
                          className={`max-w-[85%] break-words rounded-xl px-3 py-2 text-sm ${
                            isMe
                              ? "rounded-br-none bg-[#e76f51] text-white"
                              : "rounded-bl-none border border-white/5 bg-white/5 text-[#d0d7d4]"
                          }`}
                        >
                          {
                            message.text
                          }
                        </div>
                      </div>
                    )
                  }
                )
              )}
            </div>

            <form
              onSubmit={
                sendMessage
              }
              className="flex shrink-0 gap-2 border-t border-white/5 p-3"
            >
              <input
                value={draft}
                onChange={(
                  event
                ) =>
                  setDraft(
                    event.target
                      .value
                  )
                }
                placeholder={
                  sessionReplaced
                    ? "Session replaced"
                    : "Send a message..."
                }
                disabled={sessionReplaced}
                className="flex-1 rounded-xl bg-white/5 px-3 py-2 text-xs text-white outline-none placeholder:text-[#606b66] focus:ring-1 focus:ring-[#e76f51]"
              />

              <button
                type="submit"
                disabled={
                  sessionReplaced ||
                  !draft.trim()
                }
                className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#e76f51] text-white transition-colors hover:bg-[#d05d41] disabled:opacity-40"
              >
                <Send size={14} />
              </button>
            </form>
          </aside>
        )}
      </div>

      {/* ===================================================
          BOTTOM CONTROL BAR
          =================================================== */}

      <footer className="flex shrink-0 items-center justify-center border-t border-white/5 bg-[#181d1b] px-3 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))]">
        <div className="relative flex items-center gap-1.5 sm:gap-3 rounded-2xl border border-white/5 bg-white/5 p-1.5 sm:p-2 backdrop-blur-md">
          {/* MIC */}

          <button
            onClick={
              toggleMic
            }
            disabled={sessionReplaced}
            className={`grid size-10 sm:size-12 place-items-center rounded-xl transition-all ${
              micOn
                ? "bg-white/10 text-white hover:bg-white/20"
                : "border border-red-500/30 bg-red-500/20 text-red-400"
            }`}
            title={
              micOn
                ? "Mute Microphone"
                : "Unmute Microphone"
            }
          >
            {micOn ? (
              <Mic size={18} className="sm:hidden" />
            ) : (
              <MicOff size={18} className="sm:hidden" />
            )}
            {micOn ? (
              <Mic size={20} className="hidden sm:block" />
            ) : (
              <MicOff size={20} className="hidden sm:block" />
            )}
          </button>

          {/* CAMERA */}

          <button
            onClick={
              toggleCamera
            }
            disabled={sessionReplaced}
            className={`grid size-10 sm:size-12 place-items-center rounded-xl transition-all ${
              cameraOn
                ? "bg-white/10 text-white hover:bg-white/20"
                : "border border-red-500/30 bg-red-500/20 text-red-400"
            }`}
            title={
              cameraOn
                ? "Turn Camera Off"
                : "Turn Camera On"
            }
          >
            {cameraOn ? (
              <Video size={18} className="sm:hidden" />
            ) : (
              <VideoOff size={18} className="sm:hidden" />
            )}
            {cameraOn ? (
              <Video size={20} className="hidden sm:block" />
            ) : (
              <VideoOff size={20} className="hidden sm:block" />
            )}
          </button>

          {/* SCREEN SHARE */}

          <button
            onClick={() =>
              void toggleScreenShare()
            }
            disabled={sessionReplaced}
            className={`grid size-10 sm:size-12 place-items-center rounded-xl transition-all ${
              isScreenSharing
                ? "border border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
            title={
              isScreenSharing
                ? "Stop Screen Sharing"
                : "Share Screen"
            }
          >
            {isScreenSharing ? (
              <MonitorOff size={18} className="sm:hidden" />
            ) : (
              <Monitor size={18} className="sm:hidden" />
            )}
            {isScreenSharing ? (
              <MonitorOff size={20} className="hidden sm:block" />
            ) : (
              <Monitor size={20} className="hidden sm:block" />
            )}
          </button>

          {/* HAND */}

          <button
            onClick={
              toggleHandRaise
            }
            disabled={sessionReplaced}
            className={`grid size-10 sm:size-12 place-items-center rounded-xl transition-all ${
              handRaised
                ? "border border-amber-500/30 bg-amber-500/20 text-amber-400"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
            title={
              handRaised
                ? "Lower Hand"
                : "Raise Hand"
            }
          >
            <Hand size={18} className="sm:hidden" />
            <Hand size={20} className="hidden sm:block" />
          </button>

          {/* REACTION */}

          <div className="relative">
            <button
              onClick={() =>
                setShowReactions(
                  (previous) =>
                    !previous
                )
              }
              className={`grid size-10 sm:size-12 place-items-center rounded-xl transition-all ${
                showReactions
                  ? "bg-[#e76f51] text-white ring-2 ring-[#e76f51]/40"
                  : "bg-white/10 text-white hover:bg-white/20"
              }`}
              title="Send Reaction"
            >
              <Smile size={18} className="sm:hidden" />
              <Smile size={20} className="hidden sm:block" />
            </button>

            {showReactions && (
              <div className="absolute bottom-14 sm:bottom-16 left-1/2 flex -translate-x-1/2 items-center gap-1 sm:gap-1.5 rounded-2xl border border-white/15 bg-[#1e2522]/95 p-1.5 sm:p-2 shadow-2xl backdrop-blur-xl">
                {REACTION_EMOJIS.map(
                  (emoji) => (
                    <button
                      key={emoji}
                      onClick={() =>
                        sendReaction(
                          emoji
                        )
                      }
                      className="flex size-8 sm:size-10 items-center justify-center rounded-xl text-lg sm:text-xl transition-all hover:scale-125 hover:bg-white/10 active:scale-95"
                    >
                      {emoji}
                    </button>
                  )
                )}

                <div className="mx-0.5 sm:mx-1 h-5 sm:h-6 w-px bg-white/10" />

                <button
                  onClick={() =>
                    setShowReactions(
                      false
                    )
                  }
                  className="rounded-lg p-1 sm:p-1.5 text-xs text-[#a0aba6] transition-colors hover:bg-white/5 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* LEAVE */}

          <button
            onClick={() =>
              void leaveMeeting()
            }
            disabled={
              isLeaving
            }
            className="grid size-10 sm:size-12 place-items-center rounded-xl bg-red-600 text-white shadow-lg shadow-red-600/20 transition-all hover:bg-red-700 active:scale-95 disabled:opacity-50"
            title="Leave Meeting"
          >
            {isLeaving ? (
              <Loader2
                size={18}
                className="animate-spin sm:hidden"
              />
            ) : (
              <PhoneOff
                size={18}
                className="sm:hidden"
              />
            )}
            {isLeaving ? (
              <Loader2
                size={20}
                className="animate-spin hidden sm:block"
              />
            ) : (
              <PhoneOff
                size={20}
                className="hidden sm:block"
              />
            )}
          </button>
        </div>
      </footer>
    </main>
  )
}

/* =========================================================
   PARTICIPANT CARD
   ========================================================= */

type ParticipantCardProps = {
  participant: Participant
  isLocal: boolean

  setLocalVideoRef: (
    el: HTMLVideoElement | null
  ) => void

  setRemoteVideoRef: (
    id: string,
    el: HTMLVideoElement | null
  ) => void

  bgColor?: string
  isPinned?: boolean

  cameraOn?: boolean
  micOn?: boolean

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
  micOn = true,
  onPin,
  onUnpin,
}: ParticipantCardProps) {
  const isMuted =
    isLocal
      ? !micOn
      : participant.muted

  const isCameraDisabled =
    isLocal
      ? !cameraOn
      : participant.cameraOff

  return (
    <div
      className={`relative flex size-full items-center justify-center overflow-hidden ${bgColor}`}
    >
      {/* =================================================
          VIDEO
          ================================================= */}

      {isLocal ? (
        <video
          ref={
            setLocalVideoRef
          }
          autoPlay
          muted
          playsInline
          className={`size-full object-cover ${
            isCameraDisabled
              ? "hidden"
              : ""
          }`}
        />
      ) : (
        <video
          ref={(element) =>
            setRemoteVideoRef(
              participant.id,
              element
            )
          }
          autoPlay
          playsInline
          className={`size-full object-cover ${
            isCameraDisabled
              ? "hidden"
              : ""
          }`}
        />
      )}

      {/* =================================================
          AVATAR
          ================================================= */}

      {isCameraDisabled && (
        <div className="flex flex-col items-center justify-center gap-2">
          <span className="grid size-12 sm:size-16 place-items-center rounded-full bg-white/10 text-base sm:text-xl font-bold text-white shadow-md ring-1 ring-white/20">
            {initials(
              participant.name
            )}
          </span>
        </div>
      )}

      {/* =================================================
          SCREEN SHARING BADGE
          ================================================= */}

      {participant.screenSharing && (
        <div className="absolute right-2 sm:right-3 top-2 sm:top-3 z-20 flex items-center gap-1 sm:gap-1.5 rounded-full bg-emerald-500/90 px-2 sm:px-3 py-0.5 sm:py-1 text-[10px] sm:text-xs font-semibold text-black shadow-lg">
          <Monitor
            size={12}
            className="sm:hidden"
          />
          <Monitor
            size={14}
            className="hidden sm:block"
          />

          <span>
            {isLocal
              ? "You are sharing"
              : "Screen sharing"}
          </span>
        </div>
      )}

      {/* =================================================
          REACTION
          ================================================= */}

      {participant.reaction && (
        <div className="absolute bottom-10 sm:bottom-14 left-2 sm:left-3 z-20 flex items-center gap-1.5 sm:gap-2 rounded-2xl border border-white/20 bg-[#1e2522]/90 px-2.5 sm:px-3 py-1 sm:py-1.5 shadow-2xl backdrop-blur-md">
          <span className="animate-bounce text-xl sm:text-2xl">
            {
              participant.reaction
            }
          </span>

          <span className="text-[10px] sm:text-xs font-semibold text-white/90">
            {isLocal
              ? "You"
              : participant.name}
          </span>
        </div>
      )}

      {/* =================================================
          HAND
          ================================================= */}

      {participant.handRaised && (
        <div className="absolute left-2 sm:left-3 top-2 sm:top-3 z-20 flex items-center gap-1 sm:gap-1.5 rounded-full bg-amber-500/90 px-2 sm:px-3 py-0.5 sm:py-1 text-[10px] sm:text-xs font-semibold text-black shadow-lg">
          <Hand size={12} className="sm:hidden" />
          <Hand size={14} className="hidden sm:block" />

          <span>
            Hand Raised
          </span>
        </div>
      )}

      {/* =================================================
          BOTTOM OVERLAY
          ================================================= */}

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 sm:gap-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 sm:p-3 pt-6 sm:pt-8">
        {/* NAME */}

        <div className="min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-block min-w-[5ch] sm:min-w-[9ch] max-w-full whitespace-normal break-words text-[11px] sm:text-xs font-medium leading-4 sm:leading-5 text-white">
            {participant.name}{" "}
            {isLocal && "(You)"}
          </span>

          {participant.screenSharing && (
            <span className="ml-1 sm:ml-2 shrink-0 text-[9px] sm:text-[10px] text-emerald-300">
              Sharing
            </span>
          )}
        </div>

        {/* CONTROLS */}

        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          {/* MIC STATUS */}

          <span
            className={`rounded-full p-1 transition-colors ${
              isMuted
                ? "bg-red-500/80 text-white"
                : "bg-black/40 text-white/80"
            }`}
            title={
              isMuted
                ? "Microphone off"
                : "Microphone on"
            }
          >
            {isMuted ? (
              <MicOff
                size={12}
              />
            ) : (
              <Mic size={12} />
            )}
          </span>

          {/* CAMERA STATUS */}

          <span
            className={`rounded-full p-1 ${
              isCameraDisabled
                ? "bg-red-500/80 text-white"
                : "bg-black/40 text-white/80"
            }`}
            title={
              isCameraDisabled
                ? "Camera off"
                : "Camera on"
            }
          >
            {isCameraDisabled ? (
              <VideoOff
                size={12}
              />
            ) : (
              <Video size={12} />
            )}
          </span>

          {/* PIN */}

          {isPinned ? (
            <button
              onClick={
                onUnpin
              }
              className="rounded-full bg-black/40 p-1 text-white/80 hover:bg-white/20 hover:text-white"
              title="Unpin stream"
            >
              <PinOff
                size={12}
              />
            </button>
          ) : (
            onPin && (
              <button
                onClick={onPin}
                className="rounded-full bg-black/40 p-1 text-white/80 hover:bg-white/20 hover:text-white"
                title="Pin stream"
              >
                <Pin
                  size={12}
                />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
