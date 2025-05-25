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

  useEffect(() => {
    initializeCall()
    return () => {
      cleanup()
    }
  }, [])

  const initializeCall = async () => {
    try {
      console.log(`[${username}] Initializing call as ${isInitiator ? "initiator" : "receiver"}`)

      // Get user media first
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true,
      })

      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      // Create peer connection with better configuration
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

      // Add local stream to peer connection
      stream.getTracks().forEach((track) => {
        console.log(`[${username}] Adding track:`, track.kind)
        peerConnection.addTrack(track, stream)
      })

      // Handle remote stream
      peerConnection.ontrack = (event) => {
        console.log(`[${username}] Received remote track:`, event.track.kind)
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0]
          setRemoteStreamReceived(true)
          setConnectionStatus("connected")
        }
      }

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`[${username}] Sending ICE candidate`)
          sendSignalingMessage("ice-candidate", {
            candidate: event.candidate,
          })
        }
      }

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log(`[${username}] Connection state:`, peerConnection.connectionState)
        if (peerConnection.connectionState === "connected") {
          setConnectionStatus("connected")
        } else if (peerConnection.connectionState === "disconnected" || peerConnection.connectionState === "failed") {
          setConnectionStatus("disconnected")
        }
      }

      // Handle ICE connection state
      peerConnection.oniceconnectionstatechange = () => {
        console.log(`[${username}] ICE connection state:`, peerConnection.iceConnectionState)
      }

      // Set up signaling channel
      await setupSignalingChannel(peerConnection)

      // If initiator, wait a bit then create offer
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

      // Process queued ICE candidates
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

      // Process queued ICE candidates
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
        // Queue the candidate if remote description is not set yet
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
    <div className="flex flex-col h-screen bg-black relative">
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
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75">
            <div className="text-white text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
              <div className="text-xl">Connecting...</div>
              <div className="text-sm mt-2 opacity-75">
                {isInitiator ? "Waiting for other user to join" : "Joining call"}
              </div>
            </div>
          </div>
        )}
        {connectionStatus === "disconnected" && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
            <div className="text-white text-center">
              <div className="text-xl mb-4">Connection lost</div>
              <Button onClick={endCall} variant="destructive">
                End Call
              </Button>
            </div>
          </div>
        )}
        {!remoteStreamReceived && connectionStatus === "connected" && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
            <div className="text-white text-center">
              <div className="text-xl">Waiting for video...</div>
            </div>
          </div>
        )}
      </div>

      {/* Local video (picture-in-picture) */}
      <div className="absolute top-4 right-4 w-48 h-36 bg-gray-800 rounded-lg overflow-hidden border-2 border-white">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
        <div className="absolute bottom-2 left-2 text-white text-xs bg-black bg-opacity-50 px-2 py-1 rounded">You</div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2">
        <div className="flex space-x-4 bg-black bg-opacity-50 rounded-full p-4">
          <Button
            variant={isAudioEnabled ? "secondary" : "destructive"}
            size="lg"
            onClick={toggleAudio}
            className="rounded-full w-14 h-14"
          >
            {isAudioEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </Button>

          <Button
            variant={isVideoEnabled ? "secondary" : "destructive"}
            size="lg"
            onClick={toggleVideo}
            className="rounded-full w-14 h-14"
          >
            {isVideoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
          </Button>

          <Button variant="destructive" size="lg" onClick={endCall} className="rounded-full w-14 h-14">
            <PhoneOff className="w-6 h-6" />
          </Button>
        </div>
      </div>

      {/* Connection status indicator */}
      <div className="absolute top-4 left-4">
        <div
          className={`px-3 py-1 rounded-full text-sm font-medium ${
            connectionStatus === "connected"
              ? "bg-green-500 text-white"
              : connectionStatus === "connecting"
                ? "bg-yellow-500 text-black"
                : "bg-red-500 text-white"
          }`}
        >
          {connectionStatus === "connected"
            ? "Connected"
            : connectionStatus === "connecting"
              ? "Connecting..."
              : "Disconnected"}
        </div>
      </div>

      {/* Debug info (remove in production) */}
      <div className="absolute bottom-4 left-4 text-white text-xs bg-black bg-opacity-50 p-2 rounded">
        <div>Role: {isInitiator ? "Initiator" : "Receiver"}</div>
        <div>Status: {connectionStatus}</div>
        <div>Remote Stream: {remoteStreamReceived ? "Yes" : "No"}</div>
      </div>
    </div>
  )
}
