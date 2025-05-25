"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function WebRTCTest() {
  const [hasCamera, setHasCamera] = useState<boolean | null>(null)
  const [hasMicrophone, setHasMicrophone] = useState<boolean | null>(null)
  const [testing, setTesting] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const testWebRTC = async () => {
    setTesting(true)
    try {
      // Test camera and microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })

      setHasCamera(true)
      setHasMicrophone(true)

      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      // Stop the stream after test
      setTimeout(() => {
        stream.getTracks().forEach((track) => track.stop())
        if (videoRef.current) {
          videoRef.current.srcObject = null
        }
      }, 5000)
    } catch (error: any) {
      console.error("WebRTC test failed:", error)
      if (error.name === "NotAllowedError") {
        setHasCamera(false)
        setHasMicrophone(false)
      }
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>WebRTC Test</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          <video ref={videoRef} autoPlay muted className="w-full h-32 bg-gray-200 rounded" />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Camera:</span>
            <span className={hasCamera === true ? "text-green-600" : hasCamera === false ? "text-red-600" : ""}>
              {hasCamera === null ? "Not tested" : hasCamera ? "✓ Working" : "✗ Not available"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Microphone:</span>
            <span className={hasMicrophone === true ? "text-green-600" : hasMicrophone === false ? "text-red-600" : ""}>
              {hasMicrophone === null ? "Not tested" : hasMicrophone ? "✓ Working" : "✗ Not available"}
            </span>
          </div>
        </div>

        <Button onClick={testWebRTC} disabled={testing} className="w-full">
          {testing ? "Testing..." : "Test Camera & Microphone"}
        </Button>
      </CardContent>
    </Card>
  )
}
