"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { User, Shield, Video } from "lucide-react"

interface LoginFormProps {
  onLogin: (username: string) => void
  loading: boolean
  error: string | null
}

export default function LoginForm({ onLogin, loading, error }: LoginFormProps) {
  const [username, setUsername] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (username.trim() && !loading) {
      onLogin(username.trim())
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto bg-white/10 backdrop-blur-lg border-white/20 shadow-2xl">
      <CardHeader className="text-center space-y-4">
        <div className="mx-auto w-16 h-16 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
          <Video className="w-8 h-8 text-white" />
        </div>
        <CardTitle className="text-2xl font-bold text-white">Join Campus Chat</CardTitle>
        <p className="text-gray-300">Enter your name to start connecting with verified students</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="block text-sm font-medium text-gray-300">
              Display Name
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your name"
                required
                maxLength={50}
                disabled={loading}
                className="pl-10 bg-white/10 border-white/20 text-white placeholder-gray-400 focus:border-purple-400 focus:ring-purple-400"
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="bg-red-500/20 border-red-500/50 text-red-200">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold py-3 rounded-lg transition-all duration-200 transform hover:scale-105"
            disabled={!username.trim() || loading}
          >
            {loading ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Connecting...</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Shield className="w-5 h-5" />
                <span>Start Chatting</span>
              </div>
            )}
          </Button>
        </form>

        <div className="text-center space-y-3">
          <div className="flex items-center justify-center space-x-2 text-sm text-gray-400">
            <Shield className="w-4 h-4" />
            <span>Verified student connections only</span>
          </div>
          <div className="text-xs text-gray-500">
            By continuing, you agree to our Terms of Service and Privacy Policy
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
