"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import VideoCall from "@/components/video-call"
import { Video, MessageCircle, Send, Users } from "lucide-react"

interface Message {
  id: string
  content: string
  sender_id: string
  sender_username: string
  created_at: string
}

interface ChatRoom {
  id: string
  user1_id: string
  user2_id: string
  user1_username: string
  user2_username: string
  is_active: boolean
}

interface User {
  id: string
  username: string
}

export default function ChatInterface({ currentUser }: { currentUser: User }) {
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [isInVideoCall, setIsInVideoCall] = useState(false)
  const [onlineCount, setOnlineCount] = useState(0)
  const [otherUser, setOtherUser] = useState<string>("")
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getOnlineCount()
    const interval = setInterval(getOnlineCount, 30000) // Update every 30 seconds
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (chatRoom) {
      subscribeToMessages()
      setOtherUser(chatRoom.user1_id === currentUser.id ? chatRoom.user2_username : chatRoom.user1_username)
    }
  }, [chatRoom])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const getOnlineCount = async () => {
    try {
      const { count } = await supabase.from("users").select("*", { count: "exact", head: true }).eq("is_online", true)
      setOnlineCount(count || 0)
    } catch (error) {
      console.error("Error getting online count:", error)
    }
  }

  const findMatch = async () => {
    setIsSearching(true)

    try {
      console.log("Adding user to waiting queue:", currentUser.username)

      // Add user to waiting queue
      const { error: queueError } = await supabase.from("waiting_queue").upsert({
        user_id: currentUser.id,
        username: currentUser.username,
      })

      if (queueError) {
        console.error("Error adding to queue:", queueError)
        throw queueError
      }

      // Look for another user in queue
      const { data: waitingUsers, error: searchError } = await supabase
        .from("waiting_queue")
        .select("*")
        .neq("user_id", currentUser.id)
        .limit(1)

      if (searchError) {
        console.error("Error searching queue:", searchError)
        throw searchError
      }

      console.log("Found waiting users:", waitingUsers)

      if (waitingUsers && waitingUsers.length > 0) {
        const matchedUser = waitingUsers[0]
        console.log("Matched with user:", matchedUser.username)

        // Create chat room
        const { data: room, error: roomError } = await supabase
          .from("chat_rooms")
          .insert({
            user1_id: currentUser.id,
            user2_id: matchedUser.user_id,
            user1_username: currentUser.username,
            user2_username: matchedUser.username,
            is_active: true,
          })
          .select()
          .single()

        if (roomError) {
          console.error("Error creating room:", roomError)
          throw roomError
        }

        console.log("Created room:", room)
        setChatRoom(room)
        setIsSearching(false)

        // Remove both users from waiting queue
        await supabase.from("waiting_queue").delete().in("user_id", [currentUser.id, matchedUser.user_id])
        console.log("Removed users from queue")

        // Automatically start video call after 2 seconds
        setTimeout(() => {
          setIsInVideoCall(true)
        }, 2000)
      } else {
        // Check for existing room where this user is user2
        const { data: existingRoom } = await supabase
          .from("chat_rooms")
          .select("*")
          .eq("user2_id", currentUser.id)
          .eq("is_active", true)
          .single()

        if (existingRoom) {
          console.log("Found existing room:", existingRoom)
          setChatRoom(existingRoom)
          setIsSearching(false)
          await supabase.from("waiting_queue").delete().eq("user_id", currentUser.id)

          // Automatically start video call for the second user
          setTimeout(() => {
            setIsInVideoCall(true)
          }, 1000)
        } else {
          // Wait and try again
          console.log("No match found, waiting...")
          setTimeout(() => {
            if (isSearching) {
              findMatch()
            }
          }, 2000)
        }
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
    if (!newMessage.trim() || !chatRoom) return

    try {
      await supabase.from("messages").insert({
        room_id: chatRoom.id,
        sender_id: currentUser.id,
        sender_username: currentUser.username,
        content: newMessage.trim(),
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
      await supabase.from("chat_rooms").update({ is_active: false }).eq("id", chatRoom.id)

      setChatRoom(null)
      setMessages([])
      setIsInVideoCall(false)
      setIsSearching(false)
      setOtherUser("")
    } catch (error) {
      console.error("Error ending chat:", error)
    }
  }

  const stopSearching = async () => {
    setIsSearching(false)
    await supabase.from("waiting_queue").delete().eq("user_id", currentUser.id)
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  if (isInVideoCall && chatRoom) {
    return (
      <VideoCall
        roomId={chatRoom.id}
        userId={currentUser.id}
        username={currentUser.username}
        isInitiator={chatRoom.user1_id === currentUser.id}
        onEndCall={endVideoCall}
      />
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold">Video Chat</h1>
            <div className="flex items-center space-x-1 text-sm text-gray-600">
              <Users className="w-4 h-4" />
              <span>{onlineCount} online</span>
            </div>
          </div>
          <div className="text-sm text-gray-600">Welcome, {currentUser.username}!</div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4">
        {!chatRoom && !isSearching && (
          <Card className="text-center">
            <CardContent className="py-12">
              <div className="mb-6">
                <Video className="w-16 h-16 mx-auto text-blue-500 mb-4" />
                <h2 className="text-3xl font-bold mb-2">Ready to connect?</h2>
                <p className="text-gray-600 text-lg">Start a video chat with someone new</p>
              </div>
              <Button onClick={findMatch} size="lg" className="px-8 py-3 text-lg">
                <MessageCircle className="w-5 h-5 mr-2" />
                Find Someone to Chat
              </Button>
            </CardContent>
          </Card>
        )}

        {isSearching && (
          <Card className="text-center">
            <CardContent className="py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-6"></div>
              <h2 className="text-2xl font-bold mb-2">Looking for someone to chat with...</h2>
              <p className="text-gray-600 mb-6">This might take a moment</p>
              <Button variant="outline" onClick={stopSearching}>
                Cancel Search
              </Button>
            </CardContent>
          </Card>
        )}

        {chatRoom && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[600px]">
            {/* Video Call Area */}
            <div className="lg:col-span-2">
              <Card className="h-full">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-lg">Video with {otherUser}</CardTitle>
                  <Button onClick={startVideoCall} className="flex items-center space-x-2">
                    <Video className="w-4 h-4" />
                    <span>Start Video Call</span>
                  </Button>
                </CardHeader>
                <CardContent className="flex-1 flex items-center justify-center bg-gray-900 text-white rounded-lg">
                  <div className="text-center">
                    <Video className="w-24 h-24 mx-auto mb-4 opacity-50" />
                    <p className="text-lg">Click "Start Video Call" to begin</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Chat Area */}
            <div className="lg:col-span-1">
              <Card className="h-full flex flex-col">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-lg">Chat</CardTitle>
                  <Button variant="destructive" size="sm" onClick={endChat}>
                    End Chat
                  </Button>
                </CardHeader>

                <CardContent className="flex-1 flex flex-col p-0">
                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-96">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.sender_id === currentUser.id ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-xs px-3 py-2 rounded-lg text-sm ${
                            message.sender_id === currentUser.id
                              ? "bg-blue-500 text-white"
                              : "bg-gray-200 text-gray-800"
                          }`}
                        >
                          <div className="font-medium text-xs mb-1 opacity-75">
                            {message.sender_id === currentUser.id ? "You" : message.sender_username}
                          </div>
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
                      <Button type="submit" size="sm">
                        <Send className="w-4 h-4" />
                      </Button>
                    </form>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
