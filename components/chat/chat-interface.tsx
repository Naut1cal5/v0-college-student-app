"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import VideoCall from "@/components/video/video-call"
import { Video, MessageCircle, Users, LogOut } from "lucide-react"

interface Message {
  id: string
  content: string
  sender_id: string
  created_at: string
  message_type: string
}

interface ChatRoom {
  id: string
  user1_id: string
  user2_id: string
  is_active: boolean
}

interface User {
  id: string
  display_name: string
  college_domain: string
}

export default function ChatInterface() {
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [isInVideoCall, setIsInVideoCall] = useState(false)
  const [onlineCount, setOnlineCount] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    initializeUser()
    getOnlineCount()
  }, [])

  useEffect(() => {
    if (chatRoom) {
      subscribeToMessages()
    }
  }, [chatRoom])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const initializeUser = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        window.location.href = "/"
        return
      }

      const { data: userData } = await supabase.from("users").select("*").eq("id", user.id).single()

      if (userData) {
        setCurrentUser(userData)
        // Update user as online
        await supabase.from("users").update({ is_online: true }).eq("id", user.id)
      }
    } catch (error) {
      console.error("Error initializing user:", error)
    }
  }

  const getOnlineCount = async () => {
    try {
      const { count } = await supabase.from("users").select("*", { count: "exact", head: true }).eq("is_online", true)

      setOnlineCount(count || 0)
    } catch (error) {
      console.error("Error getting online count:", error)
    }
  }

  const findMatch = async () => {
    if (!currentUser) return

    setIsSearching(true)

    try {
      // Add user to waiting queue
      await supabase.from("waiting_queue").upsert({ user_id: currentUser.id })

      // Look for another user in queue
      const { data: waitingUsers } = await supabase
        .from("waiting_queue")
        .select("user_id")
        .neq("user_id", currentUser.id)
        .limit(1)

      if (waitingUsers && waitingUsers.length > 0) {
        const matchedUserId = waitingUsers[0].user_id

        // Create chat room
        const { data: room } = await supabase
          .from("chat_rooms")
          .insert({
            user1_id: currentUser.id,
            user2_id: matchedUserId,
            is_active: true,
          })
          .select()
          .single()

        if (room) {
          setChatRoom(room)

          // Remove both users from waiting queue
          await supabase.from("waiting_queue").delete().in("user_id", [currentUser.id, matchedUserId])
        }
      } else {
        // Wait for a match
        setTimeout(() => {
          if (isSearching) {
            findMatch()
          }
        }, 2000)
      }
    } catch (error) {
      console.error("Error finding match:", error)
      setIsSearching(false)
    }
  }

  const subscribeToMessages = () => {
    if (!chatRoom) return

    const channel = supabase
      .channel(`room-${chatRoom.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${chatRoom.id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message])
        },
      )
      .subscribe()

    // Load existing messages
    loadMessages()

    return () => {
      supabase.removeChannel(channel)
    }
  }

  const loadMessages = async () => {
    if (!chatRoom) return

    try {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("room_id", chatRoom.id)
        .order("created_at", { ascending: true })

      if (data) {
        setMessages(data)
      }
    } catch (error) {
      console.error("Error loading messages:", error)
    }
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !chatRoom || !currentUser) return

    try {
      await supabase.from("messages").insert({
        room_id: chatRoom.id,
        sender_id: currentUser.id,
        content: newMessage.trim(),
        message_type: "text",
      })

      setNewMessage("")
    } catch (error) {
      console.error("Error sending message:", error)
    }
  }

  const startVideoCall = () => {
    setIsInVideoCall(true)
  }

  const endVideoCall = () => {
    setIsInVideoCall(false)
  }

  const endChat = async () => {
    if (!chatRoom) return

    try {
      await supabase
        .from("chat_rooms")
        .update({ is_active: false, ended_at: new Date().toISOString() })
        .eq("id", chatRoom.id)

      setChatRoom(null)
      setMessages([])
      setIsInVideoCall(false)
      setIsSearching(false)
    } catch (error) {
      console.error("Error ending chat:", error)
    }
  }

  const logout = async () => {
    if (currentUser) {
      await supabase.from("users").update({ is_online: false }).eq("id", currentUser.id)
    }

    await supabase.auth.signOut()
    window.location.href = "/"
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const stopSearching = async () => {
    setIsSearching(false)
    if (currentUser) {
      await supabase.from("waiting_queue").delete().eq("user_id", currentUser.id)
    }
  }

  if (!currentUser) {
    return <div>Loading...</div>
  }

  if (isInVideoCall && chatRoom) {
    return (
      <div className="h-screen">
        <VideoCall roomId={chatRoom.id} isInitiator={chatRoom.user1_id === currentUser.id} onEndCall={endVideoCall} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold">College Chat</h1>
            <Badge variant="secondary" className="flex items-center space-x-1">
              <Users className="w-3 h-3" />
              <span>{onlineCount} online</span>
            </Badge>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">
              {currentUser.display_name} ({currentUser.college_domain})
            </span>
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4">
        {!chatRoom && !isSearching && (
          <Card className="text-center">
            <CardContent className="py-8">
              <h2 className="text-2xl font-bold mb-4">Ready to meet someone new?</h2>
              <p className="text-gray-600 mb-6">Connect with other college students for text and video chat</p>
              <Button onClick={findMatch} size="lg">
                <MessageCircle className="w-4 h-4 mr-2" />
                Start Chatting
              </Button>
            </CardContent>
          </Card>
        )}

        {isSearching && (
          <Card className="text-center">
            <CardContent className="py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <h2 className="text-xl font-bold mb-2">Finding someone to chat with...</h2>
              <p className="text-gray-600 mb-4">This might take a moment</p>
              <Button variant="outline" onClick={stopSearching}>
                Cancel
              </Button>
            </CardContent>
          </Card>
        )}

        {chatRoom && (
          <Card className="h-[600px] flex flex-col">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg">Chat Room</CardTitle>
              <div className="flex space-x-2">
                <Button variant="outline" size="sm" onClick={startVideoCall}>
                  <Video className="w-4 h-4 mr-1" />
                  Video Call
                </Button>
                <Button variant="destructive" size="sm" onClick={endChat}>
                  End Chat
                </Button>
              </div>
            </CardHeader>

            <CardContent className="flex-1 flex flex-col p-0">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender_id === currentUser.id ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        message.sender_id === currentUser.id ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-800"
                      }`}
                    >
                      {message.content}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Message input */}
              <div className="border-t p-4">
                <form onSubmit={sendMessage} className="flex space-x-2">
                  <Input
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1"
                  />
                  <Button type="submit">Send</Button>
                </form>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
