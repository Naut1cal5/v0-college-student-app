"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react"
import { supabase } from "@/lib/supabase"

interface VideoCallProps {
  roomId: string
  userId: string
  username: string
  isInitiator: boolean
  onEndCall: () => void
}

export default function VideoCall({ roomId, userId, username, isInitiator, onEndCall }: VideoCallProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const signalingChannelRef = useRef<any>(null)
  const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([])

  const [isVideoEnabled, setIsVideoEnabled] = useState(true)
  const [isAudioEnabled, setIsAudioEnabled] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("connecting")
  const [remoteStreamReceived, setRemoteStreamReceived] = useState(false)
  const [callDuration, setCallDuration] = useState(0)

  useEffect(() => {
    initializeCall()
    return () => {
      cleanup()
    }
  }, [])

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (connectionStatus === "connected") {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1)
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [connectionStatus])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const initializeCall = async () => {
    try {
      console.log(`[${username}] Initializing call as ${isInitiator ? "initiator" : "receiver"}`)

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true,
      })

      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      const configuration = {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:stun3.l.google.com:19302" },
        ],
        iceCandidatePoolSize: 10,
      }

      const peerConnection = new RTCPeerConnection(configuration)
      peerConnectionRef.current = peerConnection

      stream.getTracks().forEach((track) => {
        console.log(`[${username}] Adding track:`, track.kind)
        peerConnection.addTrack(track, stream)
      })

      peerConnection.ontrack = (event) => {
        console.log(`[${username}] Received remote track:`, event.track.kind)
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0]
          setRemoteStreamReceived(true)
          setConnectionStatus("connected")
        }
      }

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`[${username}] Sending ICE candidate`)
          sendSignalingMessage("ice-candidate", {
            candidate: event.candidate,
          })
        }
      }

      peerConnection.onconnectionstatechange = () => {
        console.log(`[${username}] Connection state:`, peerConnection.connectionState)
        if (peerConnection.connectionState === "connected") {
          setConnectionStatus("connected")
        } else if (peerConnection.connectionState === "disconnected" || peerConnection.connectionState === "failed") {
          setConnectionStatus("disconnected")
        }
      }

      peerConnection.oniceconnectionstatechange = () => {
        console.log(`[${username}] ICE connection state:`, peerConnection.iceConnectionState)
      }

      await setupSignalingChannel(peerConnection)

      if (isInitiator) {
        console.log(`[${username}] Will create offer in 2 seconds`)
        setTimeout(async () => {
          await createOffer(peerConnection)
        }, 2000)
      }
    } catch (error) {
      console.error(`[${username}] Error initializing call:`, error)
      setConnectionStatus("disconnected")
    }
  }

  const setupSignalingChannel = async (peerConnection: RTCPeerConnection) => {
    const channel = supabase.channel(`webrtc-${roomId}`, {
      config: {
        broadcast: { self: true },
      },
    })

    channel
      .on("broadcast", { event: "offer" }, async ({ payload }) => {
        if (payload.senderId !== userId) {
          console.log(`[${username}] Received offer from ${payload.senderId}`)
          await handleOffer(peerConnection, payload.offer)
        }
      })
      .on("broadcast", { event: "answer" }, async ({ payload }) => {
        if (payload.senderId !== userId) {
          console.log(`[${username}] Received answer from ${payload.senderId}`)
          await handleAnswer(peerConnection, payload.answer)
        }
      })
      .on("broadcast", { event: "ice-candidate" }, async ({ payload }) => {
        if (payload.senderId !== userId) {
          console.log(`[${username}] Received ICE candidate from ${payload.senderId}`)
          await handleIceCandidate(peerConnection, payload.candidate)
        }
      })

    await channel.subscribe()
    signalingChannelRef.current = channel
    console.log(`[${username}] Signaling channel setup complete`)
  }

  const sendSignalingMessage = (event: string, data: any) => {
    if (signalingChannelRef.current) {
      signalingChannelRef.current.send({
        type: "broadcast",
        event,
        payload: {
          ...data,
          senderId: userId,
          roomId,
        },
      })
    }
  }

  const createOffer = async (peerConnection: RTCPeerConnection) => {
    try {
      console.log(`[${username}] Creating offer`)
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      })
      await peerConnection.setLocalDescription(offer)
      console.log(`[${username}] Sending offer`)

      sendSignalingMessage("offer", { offer })
    } catch (error) {
      console.error(`[${username}] Error creating offer:`, error)
    }
  }

  const handleOffer = async (peerConnection: RTCPeerConnection, offer: RTCSessionDescriptionInit) => {
    try {
      console.log(`[${username}] Handling offer`)
      await peerConnection.setRemoteDescription(offer)

      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift()
        if (candidate) {
          await peerConnection.addIceCandidate(candidate)
        }
      }

      const answer = await peerConnection.createAnswer()
      await peerConnection.setLocalDescription(answer)
      console.log(`[${username}] Sending answer`)

      sendSignalingMessage("answer", { answer })
    } catch (error) {
      console.error(`[${username}] Error handling offer:`, error)
    }
  }

  const handleAnswer = async (peerConnection: RTCPeerConnection, answer: RTCSessionDescriptionInit) => {
    try {
      console.log(`[${username}] Handling answer`)
      await peerConnection.setRemoteDescription(answer)

      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift()
        if (candidate) {
          await peerConnection.addIceCandidate(candidate)
        }
      }
    } catch (error) {
      console.error(`[${username}] Error handling answer:`, error)
    }
  }

  const handleIceCandidate = async (peerConnection: RTCPeerConnection, candidate: RTCIceCandidateInit) => {
    try {
      if (peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(candidate)
        console.log(`[${username}] Added ICE candidate`)
      } else {
        iceCandidatesQueue.current.push(candidate)
        console.log(`[${username}] Queued ICE candidate`)
      }
    } catch (error) {
      console.error(`[${username}] Error handling ICE candidate:`, error)
    }
  }

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        setIsVideoEnabled(videoTrack.enabled)
      }
    }
  }

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setIsAudioEnabled(audioTrack.enabled)
      }
    }
  }

  const endCall = () => {
    cleanup()
    onEndCall()
  }

  const cleanup = () => {
    console.log(`[${username}] Cleaning up call`)
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop())
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close()
    }
    if (signalingChannelRef.current) {
      supabase.removeChannel(signalingChannelRef.current)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 relative">
      {/* Header */}
      <div className="bg-black/20 backdrop-blur-lg border-b border-white/10 p-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold text-white">
              Campus<span className="text-purple-400">Chat</span>
            </h1>
            <div className="flex items-center space-x-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  connectionStatus === "connected"
                    ? "bg-green-400 animate-pulse"
                    : connectionStatus === "connecting"
                      ? "bg-yellow-400 animate-pulse"
                      : "bg-red-400"
                }`}
              ></div>
              <span className="text-gray-300 text-sm">
                {connectionStatus === "connected"
                  ? `Connected • ${formatDuration(callDuration)}`
                  : connectionStatus === "connecting"
                    ? "Connecting..."
                    : "Disconnected"}
              </span>
            </div>
          </div>
          <Button
            onClick={endCall}
            variant="destructive"
            className="bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600"
          >
            <PhoneOff className="w-4 h-4 mr-2" />
            End Call
          </Button>
        </div>
      </div>

      {/* Remote video (main view) */}
      <div className="flex-1 relative">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
        {connectionStatus === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/75 backdrop-blur-sm">
            <div className="text-white text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-purple-400 mx-auto mb-6"></div>
              <div className="text-2xl font-bold mb-2">Connecting...</div>
              <div className="text-gray-300">{isInitiator ? "Waiting for other user to join" : "Joining call"}</div>
            </div>
          </div>
        )}
        {connectionStatus === "disconnected" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/75 backdrop-blur-sm">
            <div className="text-white text-center">
              <div className="text-2xl font-bold mb-4">Connection Lost</div>
              <Button onClick={endCall} variant="destructive" size="lg">
                End Call
              </Button>
            </div>
          </div>
        )}
        {!remoteStreamReceived && connectionStatus === "connected" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/75 backdrop-blur-sm">
            <div className="text-white text-center">
              <div className="text-xl">Waiting for video...</div>
            </div>
          </div>
        )}
      </div>

      {/* Local video (picture-in-picture) */}
      <div className="absolute top-20 right-6 w-64 h-48 bg-black/50 rounded-xl overflow-hidden border-2 border-white/20 backdrop-blur-sm">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
        <div className="absolute bottom-2 left-2 bg-black/50 backdrop-blur-sm text-white text-xs px-2 py-1 rounded">
          You
        </div>
        {!isVideoEnabled && (
          <div className="absolute inset-0 bg-black/75 flex items-center justify-center">
            <VideoOff className="w-8 h-8 text-white" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2">
        <div className="flex space-x-4 bg-black/50 backdrop-blur-lg rounded-full p-4 border border-white/20">
          <Button
            variant={isAudioEnabled ? "secondary" : "destructive"}
            size="lg"
            onClick={toggleAudio}
            className={`rounded-full w-16 h-16 ${
              isAudioEnabled
                ? "bg-white/20 hover:bg-white/30 text-white border-white/20"
                : "bg-red-500 hover:bg-red-600 text-white"
            }`}
          >
            {isAudioEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </Button>

          <Button
            variant={isVideoEnabled ? "secondary" : "destructive"}
            size="lg"
            onClick={toggleVideo}
            className={`rounded-full w-16 h-16 ${
              isVideoEnabled
                ? "bg-white/20 hover:bg-white/30 text-white border-white/20"
                : "bg-red-500 hover:bg-red-600 text-white"
            }`}
          >
            {isVideoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
          </Button>

          <Button
            variant="destructive"
            size="lg"
            onClick={endCall}
            className="rounded-full w-16 h-16 bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600"
          >
            <PhoneOff className="w-6 h-6" />
          </Button>
        </div>
      </div>
    </div>
  )
}
