"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import LoginForm from "@/components/login-form"
import ChatInterface from "@/components/chat-interface"

interface User {
  id: string
  username: string
}

export default function HomePage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Clean up offline users on page load
    const cleanupOfflineUsers = async () => {
      try {
        await supabase.from("users").update({ is_online: false }).eq("is_online", true)
      } catch (error) {
        console.error("Error cleaning up offline users:", error)
      }
    }
    cleanupOfflineUsers()
  }, [])

  const handleLogin = async (username: string) => {
    setLoading(true)
    setError(null)

    try {
      console.log("Attempting to create user with username:", username)

      // First, try to find existing user with this username
      const { data: existingUser, error: findError } = await supabase
        .from("users")
        .select("*")
        .eq("username", username)
        .single()

      if (findError && findError.code !== "PGRST116") {
        // PGRST116 is "not found" error, which is expected for new users
        throw findError
      }

      let user: User

      if (existingUser) {
        // Update existing user to online
        const { data: updatedUser, error: updateError } = await supabase
          .from("users")
          .update({ is_online: true })
          .eq("id", existingUser.id)
          .select()
          .single()

        if (updateError) throw updateError
        user = updatedUser
        console.log("Updated existing user:", user)
      } else {
        // Create new user
        const { data: newUser, error: insertError } = await supabase
          .from("users")
          .insert({
            username,
            is_online: true,
          })
          .select()
          .single()

        if (insertError) throw insertError
        user = newUser
        console.log("Created new user:", user)
      }

      setCurrentUser(user)
      console.log("Login successful, user set:", user)
    } catch (error: any) {
      console.error("Login error:", error)

      if (error.code === "23505") {
        setError("This username is already taken. Please choose another one.")
      } else {
        setError(`Login failed: ${error.message || "Unknown error"}`)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Set user offline when leaving the page
    const handleBeforeUnload = async () => {
      if (currentUser) {
        await supabase.from("users").update({ is_online: false }).eq("id", currentUser.id)
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      if (currentUser) {
        supabase.from("users").update({ is_online: false }).eq("id", currentUser.id)
      }
    }
  }, [currentUser])

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black opacity-50"></div>
        <div className="relative z-10 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">
              Campus<span className="text-purple-400">Chat</span>
            </h1>
            <p className="text-gray-300 text-lg">Connect with students worldwide through verified video chat</p>
          </div>
          <LoginForm onLogin={handleLogin} loading={loading} error={error} />
        </div>

        {/* Background decoration */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
          <div className="absolute top-3/4 right-1/4 w-64 h-64 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-2000"></div>
          <div className="absolute bottom-1/4 left-1/3 w-64 h-64 bg-indigo-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-4000"></div>
        </div>
      </div>
    )
  }

  return <ChatInterface currentUser={currentUser} />
}
