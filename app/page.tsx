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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Video Chat</h1>
            <p className="text-gray-600">Connect with people through video and text</p>
          </div>
          <LoginForm onLogin={handleLogin} loading={loading} error={error} />
        </div>
      </div>
    )
  }

  return <ChatInterface currentUser={currentUser} />
}
