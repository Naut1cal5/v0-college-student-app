"use client"

import { useEffect } from "react"
import { supabase } from "@/lib/supabase"

export default function AuthCallback() {
  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()

        if (error) {
          console.error("Auth error:", error)
          window.location.href = "/?error=auth_failed"
          return
        }

        if (data.session) {
          // Check if user profile exists
          const { data: userData } = await supabase.from("users").select("*").eq("id", data.session.user.id).single()

          if (userData) {
            window.location.href = "/chat"
          } else {
            window.location.href = "/?step=profile"
          }
        } else {
          window.location.href = "/"
        }
      } catch (error) {
        console.error("Callback error:", error)
        window.location.href = "/"
      }
    }

    handleAuthCallback()
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p>Completing authentication...</p>
      </div>
    </div>
  )
}
