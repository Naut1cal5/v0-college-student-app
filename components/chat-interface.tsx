"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import VideoCall from "@/components/video-call"
import { Video, MessageCircle, Send, Users, LogOut, Search, Phone, PhoneOff } from "lucide-react"

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
    const interval = setInterval(getOnlineCount, 30000)
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

      const { error: queueError } = await supabase.from("waiting_queue").upsert({
        user_id: currentUser.id,
        username: currentUser.username,
      })

      if (queueError) {
        console.error("Error adding to queue:", queueError)
        throw queueError
      }

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

        await supabase.from("waiting_queue").delete().in("user_id", [currentUser.id, matchedUser.user_id])
        console.log("Removed users from queue")

        setTimeout(() => {
          setIsInVideoCall(true)
        }, 2000)
      } else {
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

          setTimeout(() => {
            setIsInVideoCall(true)
          }, 1000)
        } else {
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

  const logout = async () => {
    if (currentUser) {
      await supabase.from("users").update({ is_online: false }).eq("id", currentUser.id)
    }
    window.location.reload()
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
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      {/* Header */}
      <div className="bg-black/20 backdrop-blur-lg border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-6">
            <h1 className="text-2xl font-bold text-white">
              Campus<span className="text-purple-400">Chat</span>
            </h1>
            <div className="flex items-center space-x-2 bg-white/10 rounded-full px-4 py-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <Users className="w-4 h-4 text-gray-300" />
              <span className="text-gray-300 text-sm font-medium">{onlineCount} online</span>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-gray-300 text-sm">
              Welcome, <span className="font-semibold text-white">{currentUser.username}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={logout}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {!chatRoom && !isSearching && (
          <div className="flex items-center justify-center min-h-[80vh]">
            <Card className="w-full max-w-2xl bg-white/10 backdrop-blur-lg border-white/20 shadow-2xl">
              <CardContent className="py-16 text-center">
                <div className="mb-8">
                  <div className="mx-auto w-24 h-24 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full flex items-center justify-center mb-6">
                    <Video className="w-12 h-12 text-white" />
                  </div>
                  <h2 className="text-4xl font-bold text-white mb-4">Ready to Connect?</h2>
                  <p className="text-gray-300 text-lg max-w-md mx-auto">
                    Start a verified video chat with students from around the world
                  </p>
                </div>
                <Button
                  onClick={findMatch}
                  size="lg"
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold px-12 py-4 text-lg rounded-full transition-all duration-200 transform hover:scale-105"
                >
                  <Search className="w-6 h-6 mr-3" />
                  Find Someone to Chat
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {isSearching && (
          <div className="flex items-center justify-center min-h-[80vh]">
            <Card className="w-full max-w-2xl bg-white/10 backdrop-blur-lg border-white/20 shadow-2xl">
              <CardContent className="py-16 text-center">
                <div className="mb-8">
                  <div className="mx-auto w-24 h-24 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full flex items-center justify-center mb-6 animate-pulse">
                    <Search className="w-12 h-12 text-white" />
                  </div>
                  <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-purple-400 mx-auto mb-6"></div>
                  <h2 className="text-3xl font-bold text-white mb-4">Finding Your Match...</h2>
                  <p className="text-gray-300 text-lg mb-8">We're connecting you with another verified student</p>
                  <Button
                    variant="outline"
                    onClick={stopSearching}
                    className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                  >
                    Cancel Search
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {chatRoom && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[85vh]">
            {/* Video Call Area */}
            <div className="lg:col-span-3">
              <Card className="h-full bg-black/20 backdrop-blur-lg border-white/20 shadow-2xl">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-4 border-b border-white/10">
                  <CardTitle className="text-xl font-bold text-white flex items-center space-x-3">
                    <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                    <span>Video Chat with {otherUser}</span>
                  </CardTitle>
                  <div className="flex space-x-2">
                    <Button
                      onClick={startVideoCall}
                      className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white"
                    >
                      <Phone className="w-4 h-4 mr-2" />
                      Start Video Call
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={endChat}
                      className="bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600"
                    >
                      <PhoneOff className="w-4 h-4 mr-2" />
                      End Chat
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex items-center justify-center bg-gradient-to-br from-gray-900 to-black rounded-lg m-4">
                  <div className="text-center">
                    <div className="mx-auto w-32 h-32 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full flex items-center justify-center mb-6 opacity-50">
                      <Video className="w-16 h-16 text-white" />
                    </div>
                    <p className="text-gray-300 text-xl mb-4">Ready for video chat</p>
                    <p className="text-gray-500">Click "Start Video Call" to begin your conversation</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Chat Area */}
            <div className="lg:col-span-1">
              <Card className="h-full bg-white/10 backdrop-blur-lg border-white/20 shadow-2xl flex flex-col">
                <CardHeader className="border-b border-white/10 pb-4">
                  <CardTitle className="text-lg font-bold text-white flex items-center space-x-2">
                    <MessageCircle className="w-5 h-5" />
                    <span>Chat</span>
                  </CardTitle>
                </CardHeader>

                <CardContent className="flex-1 flex flex-col p-0">
                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-96">
                    {messages.length === 0 ? (
                      <div className="text-center text-gray-400 py-8">
                        <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>Start the conversation!</p>
                      </div>
                    ) : (
                      messages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex ${message.sender_id === currentUser.id ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-xs px-4 py-2 rounded-2xl text-sm ${
                              message.sender_id === currentUser.id
                                ? "bg-gradient-to-r from-purple-500 to-blue-500 text-white"
                                : "bg-white/20 text-gray-100 backdrop-blur-sm"
                            }`}
                          >
                            <div className="font-medium text-xs mb-1 opacity-75">
                              {message.sender_id === currentUser.id ? "You" : message.sender_username}
                            </div>
                            {message.content}
                          </div>
                        </div>
                      ))
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Message input */}
                  <div className="border-t border-white/10 p-4">
                    <form onSubmit={sendMessage} className="flex space-x-2">
                      <Input
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Type a message..."
                        className="flex-1 bg-white/10 border-white/20 text-white placeholder-gray-400 focus:border-purple-400 focus:ring-purple-400"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white"
                      >
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
