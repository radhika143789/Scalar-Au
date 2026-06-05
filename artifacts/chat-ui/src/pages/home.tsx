import React, { useState, useEffect, useRef } from "react";
import { Send, User, Calendar, Mail, Github, Phone, Code2, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGetChatHistory, useBookMeeting, useGetAvailability } from "@workspace/api-client-react";
import type { ChatMessage as ApiChatMessage, TimeSlot } from "@workspace/api-client-react/src/generated/api.schemas";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

// Extend ChatMessage to include slots for the UI rendering
interface LocalChatMessage extends Omit<ApiChatMessage, "id"> {
  id: string | number; // allow string for temp ids
  slots?: TimeSlot[] | null;
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string>("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  
  // Booking modal state
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [bookingName, setBookingName] = useState("");
  const [bookingEmail, setBookingEmail] = useState("");
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const bookMeeting = useBookMeeting();

  // Also pre-fetch or handle availability if requested directly without chat
  const { data: availabilityData, refetch: refetchAvailability, isFetching: isFetchingAvailability } = useGetAvailability({
    query: { enabled: false }
  });

  useEffect(() => {
    let id = localStorage.getItem("chat_sessionId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("chat_sessionId", id);
    }
    setSessionId(id);
  }, []);

  const { data: history } = useGetChatHistory(
    { sessionId },
    { query: { enabled: !!sessionId } }
  );

  useEffect(() => {
    if (history && history.length > 0 && messages.length === 0) {
      setMessages(history);
    }
  }, [history]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (messageText: string) => {
    if (!messageText.trim() || !sessionId) return;
    
    const tempId = crypto.randomUUID();
    const userMsg: LocalChatMessage = {
      id: tempId,
      sessionId,
      role: "user",
      content: messageText,
      createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);

    try {
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, sessionId }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      const assistantMsgId = crypto.randomUUID();
      let currentContent = "";
      let currentSlots: TimeSlot[] | null = null;
      
      setMessages(prev => [...prev, {
        id: assistantMsgId,
        sessionId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString()
      }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content !== undefined) {
                currentContent += data.content;
              }
              if (data.slots) {
                currentSlots = data.slots;
              }
              
              setMessages(prev => prev.map(m => 
                m.id === assistantMsgId ? { 
                  ...m, 
                  content: currentContent,
                  slots: currentSlots 
                } : m
              ));

              if (data.done) {
                setIsStreaming(false);
              }
            } catch (e) {
              console.error("Error parsing SSE data", e);
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      toast({
        title: "Connection Error",
        description: "Failed to communicate with the AI. Please try again.",
        variant: "destructive"
      });
      setIsStreaming(false);
    }
  };

  const handleBookSlot = async () => {
    if (!selectedSlot || !bookingName.trim() || !bookingEmail.trim()) return;

    try {
      await bookMeeting.mutateAsync({
        data: {
          start: selectedSlot.start,
          end: selectedSlot.end,
          attendeeName: bookingName,
          attendeeEmail: bookingEmail,
        }
      });
      
      setBookingSuccess(true);
      toast({
        title: "Interview Scheduled!",
        description: `Successfully booked with Radhika for ${selectedSlot.label}.`,
      });
      
      // Inject a fake assistant message confirming the booking in chat
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        sessionId,
        role: "assistant",
        content: `Great! I've booked that slot for you. A calendar invitation has been sent to ${bookingEmail}. Radhika is looking forward to speaking with you!`,
        createdAt: new Date().toISOString()
      }]);

    } catch (error) {
      toast({
        title: "Booking Failed",
        description: "There was an issue booking this slot. Please try another.",
        variant: "destructive"
      });
    }
  };

  const suggestions = [
    "Why is Radhika the right fit for this role?",
    "Tell me about her distributed systems project",
    "What's her experience with React and Python?",
    "Check Radhika's availability for an interview"
  ];

  return (
    <div className="flex flex-col min-h-[100dvh] bg-background text-foreground font-mono">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm tracking-wider">
            RK
          </div>
          <div>
            <h1 className="font-bold tracking-tight text-lg">Radhika Khattar</h1>
            <p className="text-xs text-primary/80 uppercase tracking-widest flex items-center gap-2">
              <Code2 className="w-3 h-3" /> AI Representative
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href="https://github.com/radhika143789" target="_blank" rel="noreferrer" className="p-2 rounded-full hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground">
            <Github className="w-5 h-5" />
          </a>
          <a href="mailto:radhikakhattar07@gmail.com" className="p-2 rounded-full hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground">
            <Mail className="w-5 h-5" />
          </a>
        </div>
      </header>

      {/* Voice Banner */}
      <div className="bg-secondary/50 border-b border-border px-6 py-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Phone className="w-3 h-3" />
        You can also call Radhika's AI agent at <span className="font-bold text-primary ml-1">+1 (555) 123-4567</span>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto text-center space-y-8 mt-12">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Code2 className="w-10 h-10 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">Hello, I'm Radhika's AI.</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                I can answer questions about her background, experience, and projects. I can also help you find time on her calendar for an interview.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full mt-8">
              {suggestions.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(suggestion)}
                  className="text-left p-4 rounded-lg border border-border bg-card/50 hover:bg-secondary hover:border-primary/50 transition-all text-sm group"
                >
                  <div className="text-primary mb-1 opacity-70 group-hover:opacity-100">[{i + 1}]</div>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-8 pb-4">
            {messages.map((msg, i) => (
              <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 shrink-0 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-xs mt-1">
                    RK
                  </div>
                )}
                
                <div className={`flex flex-col gap-2 max-w-[85%]`}>
                  <div className={`rounded-lg p-4 ${
                    msg.role === 'user' 
                      ? 'bg-secondary text-secondary-foreground border border-border' 
                      : 'bg-card border border-border/50 text-foreground'
                  }`}>
                    <div className="whitespace-pre-wrap leading-relaxed text-sm">
                      {msg.content}
                      {msg.role === 'assistant' && isStreaming && i === messages.length - 1 && (
                        <span className="inline-block w-2 h-4 bg-primary ml-1 animate-pulse align-middle" />
                      )}
                    </div>
                  </div>
                  
                  {/* Render Time Slots if available */}
                  {msg.slots && msg.slots.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                      {msg.slots.map((slot, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setSelectedSlot(slot);
                            setIsBookingModalOpen(true);
                            setBookingSuccess(false);
                          }}
                          className="flex flex-col text-left p-3 rounded-md border border-border/60 bg-card hover:bg-secondary hover:border-primary/50 transition-colors text-sm"
                        >
                          <span className="flex items-center gap-2 font-semibold text-foreground mb-1">
                            <Calendar className="w-4 h-4 text-primary" />
                            {format(new Date(slot.start), "MMM d, yyyy")}
                          </span>
                          <span className="flex items-center gap-2 text-muted-foreground text-xs">
                            <Clock className="w-3 h-3" />
                            {format(new Date(slot.start), "h:mm a")} - {format(new Date(slot.end), "h:mm a")}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {msg.role === 'user' && (
                  <div className="w-8 h-8 shrink-0 rounded-full bg-muted flex items-center justify-center text-muted-foreground mt-1">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-6 bg-card border-t border-border">
        <div className="max-w-3xl mx-auto relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-primary font-bold">
            &gt;
          </div>
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(input);
              }
            }}
            placeholder="Type your message..."
            className="w-full pl-8 pr-12 py-6 bg-background border-border focus-visible:ring-primary font-mono text-sm"
            disabled={isStreaming}
          />
          <Button 
            size="icon" 
            variant="ghost" 
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
            onClick={() => handleSend(input)}
            disabled={!input.trim() || isStreaming}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <div className="text-center mt-3 text-xs text-muted-foreground/60 flex items-center justify-center gap-2">
           <Code2 className="w-3 h-3" /> System responses generated via RAG + LLM processing
        </div>
      </div>

      {/* Booking Modal */}
      <Dialog open={isBookingModalOpen} onOpenChange={setIsBookingModalOpen}>
        <DialogContent className="sm:max-w-[425px] border-border bg-card text-foreground font-mono">
          {!bookingSuccess ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  Confirm Interview Slot
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  You are booking a session with Radhika on <br/>
                  <strong className="text-foreground">{selectedSlot?.label}</strong>.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4 mt-2">
                <div className="grid gap-2">
                  <Label htmlFor="name" className="text-muted-foreground">Your Name</Label>
                  <Input 
                    id="name" 
                    value={bookingName}
                    onChange={e => setBookingName(e.target.value)}
                    placeholder="Jane Doe"
                    className="bg-background border-border"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email" className="text-muted-foreground">Your Email</Label>
                  <Input 
                    id="email" 
                    type="email"
                    value={bookingEmail}
                    onChange={e => setBookingEmail(e.target.value)}
                    placeholder="jane@company.com"
                    className="bg-background border-border"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button 
                  variant="outline" 
                  onClick={() => setIsBookingModalOpen(false)}
                  className="border-border text-foreground hover:bg-secondary"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleBookSlot} 
                  disabled={bookMeeting.isPending || !bookingName.trim() || !bookingEmail.trim()}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {bookMeeting.isPending ? "Confirming..." : "Confirm Booking"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div className="py-6 flex flex-col items-center justify-center text-center space-y-4">
              <CheckCircle2 className="w-16 h-16 text-primary" />
              <DialogTitle className="text-xl">Booking Confirmed</DialogTitle>
              <DialogDescription className="text-muted-foreground pb-4">
                A calendar invitation has been sent to {bookingEmail}.
              </DialogDescription>
              <Button onClick={() => setIsBookingModalOpen(false)} className="w-full">
                Return to Chat
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
