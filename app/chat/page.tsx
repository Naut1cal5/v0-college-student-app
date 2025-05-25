"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import ChatInterface from "@/components/chat/chat-interface"

export default function ChatPage() {
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        window.location.href = "/"
        return
      }

      const { data: userData } = await supabase.from("users").select("*").eq("id", session.user.id).single()

      if (!userData) {
        window.location.href = "/"
        return
      }

      setAuthenticated(true)
    } catch (error) {
      console.error("Auth check error:", error)
      window.location.href = "/"
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  if (!authenticated) {
    return null
  }

  return <ChatInterface />
}
