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
  user_status: string
}

export default function ChatInterface({ currentUser }: { currentUser: User }) {
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [isInVideoCall, setIsInVideoCall] = useState(false)
  const [onlineCount, setOnlineCount] = useState(0)
  const [otherUser, setOtherUser] = useState<string>("")
  const [matchingStatus, setMatchingStatus] = useState<"idle" | "searching" | "matched">("idle")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const matchingChannelRef = useRef<any>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    getOnlineCount()
    setupMatchingSubscription()
    checkForExistingRoom()

    const interval = setInterval(getOnlineCount, 30000)
    return () => {
      clearInterval(interval)
      cleanup()
    }
  }, [])

  useEffect(() => {
    if (chatRoom) {
      subscribeToMessages()
      setOtherUser(chatRoom.user1_id === currentUser.id ? chatRoom.user2_username : chatRoom.user1_username)
      setMatchingStatus("matched")
      setIsSearching(false)
    }
  }, [chatRoom])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const setupMatchingSubscription = () => {
    // Subscribe to chat room changes to detect when we get matched
    const roomChannel = supabase
      .channel(`user-rooms-${currentUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_rooms",
          filter: `user2_id=eq.${currentUser.id}`,
        },
        (payload) => {
          console.log(`[${currentUser.username}] Received room notification:`, payload.new)
          const newRoom = payload.new as ChatRoom
          if (newRoom.is_active) {
            setChatRoom(newRoom)
            setMatchingStatus("matched")
            setIsSearching(false)
            // Clear any pending search timeouts
            if (searchTimeoutRef.current) {
              clearTimeout(searchTimeoutRef.current)
              searchTimeoutRef.current = null
            }
          }
        },
      )
      .subscribe()

    matchingChannelRef.current = roomChannel
  }

  const checkForExistingRoom = async () => {
    try {
      // Check if user is already in an active room
      const { data: existingRooms } = await supabase
        .from("chat_rooms")
        .select("*")
        .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`)
        .eq("is_active", true)
        .limit(1)

      if (existingRooms && existingRooms.length > 0) {
        console.log(`[${currentUser.username}] Found existing room:`, existingRooms[0])
        setChatRoom(existingRooms[0])
      }
    } catch (error) {
      console.error("Error checking for existing room:", error)
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
    if (isSearching || matchingStatus !== "idle") {
      console.log(`[${currentUser.username}] Already searching or matched`)
      return
    }

    setIsSearching(true)
    setMatchingStatus("searching")

    try {
      console.log(`[${currentUser.username}] Starting search for match`)

      // Update user status to searching
      await supabase.from("users").update({ user_status: "searching" }).eq("id", currentUser.id)

      // Add to waiting queue with conflict resolution
      const { error: queueError } = await supabase.from("waiting_queue").upsert(
        {
          user_id: currentUser.id,
          username: currentUser.username,
        },
        {
          onConflict: "user_id",
        },
      )

      if (queueError) {
        console.error("Error adding to queue:", queueError)
        throw queueError
      }

      // Start the matching process
      await attemptMatching()
    } catch (error) {
      console.error("Error in findMatch:", error)
      setIsSearching(false)
      setMatchingStatus("idle")
      await supabase.from("users").update({ user_status: "idle" }).eq("id", currentUser.id)
    }
  }

  const attemptMatching = async () => {
    try {
      console.log(`[${currentUser.username}] Attempting to find match`)

      // Look for other users in queue (excluding self)
      const { data: waitingUsers, error: searchError } = await supabase
        .from("waiting_queue")
        .select("*")
        .neq("user_id", currentUser.id)
        .order("created_at", { ascending: true })
        .limit(1)

      if (searchError) {
        console.error("Error searching queue:", searchError)
        throw searchError
      }

      if (waitingUsers && waitingUsers.length > 0) {
        const matchedUser = waitingUsers[0]
        console.log(`[${currentUser.username}] Found potential match:`, matchedUser.username)

        // Try to create the room (this will fail if someone else already matched with this user)
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
          console.log(`[${currentUser.username}] Failed to create room, user might be taken:`, roomError)
          // Remove the taken user from queue and try again
          await supabase.from("waiting_queue").delete().eq("user_id", matchedUser.user_id)

          // Schedule another attempt
          searchTimeoutRef.current = setTimeout(() => {
            if (isSearching && matchingStatus === "searching") {
              attemptMatching()
            }
          }, 1000)
          return
        }

        console.log(`[${currentUser.username}] Successfully created room:`, room)

        // Update both users' status
        await Promise.all([
          supabase.from("users").update({ user_status: "matched" }).eq("id", currentUser.id),
          supabase.from("users").update({ user_status: "matched" }).eq("id", matchedUser.user_id),
        ])

        // Remove both users from waiting queue
        await supabase.from("waiting_queue").delete().in("user_id", [currentUser.id, matchedUser.user_id])

        // Set the room for the current user (the other user will get it via subscription)
        setChatRoom(room)
        setMatchingStatus("matched")
        setIsSearching(false)

        console.log(`[${currentUser.username}] Match successful!`)

        // Auto-start video call after a short delay
        setTimeout(() => {
          setIsInVideoCall(true)
        }, 2000)
      } else {
        console.log(`[${currentUser.username}] No matches found, will retry`)

        // No matches found, schedule another attempt
        searchTimeoutRef.current = setTimeout(() => {
          if (isSearching && matchingStatus === "searching") {
            attemptMatching()
          }
        }, 2000)
      }
    } catch (error) {
      console.error(`[${currentUser.username}] Error in attemptMatching:`, error)

      // Schedule retry on error
      searchTimeoutRef.current = setTimeout(() => {
        if (isSearching && matchingStatus === "searching") {
          attemptMatching()
        }
      }, 3000)
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
      // End the chat room
      await supabase.from("chat_rooms").update({ is_active: false }).eq("id", chatRoom.id)

      // Update user status back to idle
      await supabase.from("users").update({ user_status: "idle" }).eq("id", currentUser.id)

      // Reset state
      setChatRoom(null)
      setMessages([])
      setIsInVideoCall(false)
      setIsSearching(false)
      setMatchingStatus("idle")
      setOtherUser("")
    } catch (error) {
      console.error("Error ending chat:", error)
    }
  }

  const stopSearching = async () => {
    console.log(`[${currentUser.username}] Stopping search`)

    setIsSearching(false)
    setMatchingStatus("idle")

    // Clear any pending timeouts
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
      searchTimeoutRef.current = null
    }

    try {
      // Update user status and remove from queue
      await Promise.all([
        supabase.from("users").update({ user_status: "idle" }).eq("id", currentUser.id),
        supabase.from("waiting_queue").delete().eq("user_id", currentUser.id),
      ])
    } catch (error) {
      console.error("Error stopping search:", error)
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const logout = async () => {
    await cleanup()
    window.location.reload()
  }

  const cleanup = async () => {
    // Clear timeouts
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Remove subscriptions
    if (matchingChannelRef.current) {
      supabase.removeChannel(matchingChannelRef.current)
    }

    // Update user status
    if (currentUser) {
      await Promise.all([
        supabase.from("users").update({ is_online: false, user_status: "idle" }).eq("id", currentUser.id),
        supabase.from("waiting_queue").delete().eq("user_id", currentUser.id),
      ])
    }
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
            {matchingStatus !== "idle" && (
              <div className="flex items-center space-x-2 bg-yellow-500/20 rounded-full px-4 py-2">
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                <span className="text-yellow-200 text-sm font-medium">
                  {matchingStatus === "searching" ? "Searching..." : "Matched!"}
                </span>
              </div>
            )}
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
                  disabled={matchingStatus !== "idle"}
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
                  <h2 className="text-3xl font-bold text-white mb-4">Finding Your Perfect Match...</h2>
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
