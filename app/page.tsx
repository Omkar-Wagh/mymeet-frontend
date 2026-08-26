'use client'

import { ArrowUpRight, Check, Copy, LockKeyhole, Mic, Play, Sparkles, Video } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'

export default function Home() {
  const [roomId, setRoomId] = useState('')
  const [copied, setCopied] = useState(false)
  const [submittedRoom, setSubmittedRoom] = useState('')
  const joinHref = submittedRoom ? `/meet/${encodeURIComponent(submittedRoom)}` : '#'

  const continueToRoom = (event: React.FormEvent) => {
    event.preventDefault()
    const nextRoom = roomId.trim()
    if (nextRoom) setSubmittedRoom(nextRoom)
  }

  const copyLink = async () => {
    if (!submittedRoom) return
    const meetUrl = `${window.location.origin}${joinHref}`
    await navigator.clipboard?.writeText(meetUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <main className="min-h-screen bg-[#f6f4ef] text-[#1f2725]">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-7 lg:px-10">
        <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight"><span className="grid size-9 place-items-center rounded-xl bg-[#e76f51] text-white"><Video size={18} /></span><span className="text-lg">MyMeet</span></Link>
        <div className="hidden items-center gap-8 text-sm text-[#65706d] md:flex"><a href="#how">How it works</a><a href="#features">Features</a></div>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-14 px-6 pb-20 pt-14 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:px-10 lg:pb-28 lg:pt-20">
        <div><div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#d7d9d1] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[.15em] text-[#65706d]"><Sparkles size={13} className="text-[#e76f51]" /> Meetings, made human</div><h1 className="max-w-2xl text-balance text-6xl font-semibold leading-[.96] tracking-[-.065em] sm:text-7xl lg:text-[6.2rem]">Just talk.<br /><span className="text-[#e76f51]">No friction.</span></h1><p className="mt-8 max-w-lg text-lg leading-8 text-[#65706d]">A focused meeting room for teams who want to get together, share ideas, and get on with the good stuff.</p><form onSubmit={continueToRoom} className="mt-10 flex max-w-md flex-col gap-3 sm:flex-row"><input value={roomId} onChange={(e) => { setRoomId(e.target.value); setSubmittedRoom(''); setCopied(false) }} placeholder="Enter a room name" aria-label="Enter room name" className="min-w-0 flex-1 rounded-2xl border border-[#d7d9d1] bg-white px-5 py-4 text-sm outline-none ring-[#e76f51] placeholder:text-[#a1aaa5] focus:ring-2" /><button type="submit" className="flex items-center justify-center gap-2 rounded-2xl bg-[#1f2725] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[#36423e]">Continue <ArrowUpRight size={16} /></button></form>{submittedRoom ? <div className="mt-4 flex max-w-md flex-col gap-3 sm:flex-row"><Link href={joinHref} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#1f2725] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[#36423e]">Join Meeting <ArrowUpRight size={16} /></Link><button onClick={copyLink} className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-[#d7d9d1] bg-white px-5 py-4 text-sm font-semibold text-[#1f2725]" aria-label="Copy Meet URL">{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied!' : 'Copy Meet URL'}</button></div> : null}<div className="mt-5 flex items-center gap-5 text-xs text-[#7b8581]"><span className="flex items-center gap-1.5"><LockKeyhole size={14} /> Private by default</span><span className="flex items-center gap-1.5"><Mic size={14} /> No account needed</span></div></div>
        <div className="relative"><div className="meeting-preview overflow-hidden rounded-[2rem] bg-[#27312f] p-3 shadow-2xl shadow-[#b8beb5]/40"><div className="mb-3 flex items-center justify-between px-3 py-2 text-xs text-[#b8c4be]"><span className="font-medium text-white">Tuesday standup</span><span className="flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-[#83c79e]" /> Live now</span></div><div className="grid grid-cols-2 gap-2"><div className="preview-tile bg-[#9aaca2]"><span>NP</span><small>Nora Patel</small></div><div className="preview-tile bg-[#c58e76]"><span>JM</span><small>Jamal Moore</small></div><div className="preview-tile bg-[#718792]"><span>SK</span><small>Sam Kim</small></div><div className="preview-tile bg-[#d0b692]"><span>YO</span><small>You</small></div></div><div className="mt-3 flex justify-center gap-2"><span className="grid size-9 place-items-center rounded-full bg-white/10 text-white"><Mic size={16} /></span><span className="grid size-9 place-items-center rounded-full bg-[#e76f51] text-white"><Video size={16} /></span><span className="grid size-9 place-items-center rounded-full bg-white/10 text-white"><Play size={15} /></span></div></div><div className="absolute -bottom-5 -left-5 hidden rounded-2xl border border-[#d7d9d1] bg-white p-4 shadow-lg sm:block"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-[#e8efe8] text-sm font-semibold text-[#49755a]">4</span><div><p className="text-sm font-semibold">People connected</p><p className="text-xs text-[#7b8581]">Everyone is in the room</p></div></div></div></div>
      </section>
      <section id="features" className="border-t border-[#dedfd9] bg-white"><div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 sm:grid-cols-3 lg:px-10"><div><h2 className="text-xl font-semibold">A room, not a maze.</h2><p className="mt-3 text-sm leading-6 text-[#65706d]">Everything you need is right there. Nothing you don&apos;t.</p></div><div><h2 className="text-xl font-semibold">Built for real talk.</h2><p className="mt-3 text-sm leading-6 text-[#65706d]">Clear video, low-latency audio, and a chat that stays out of the way.</p></div><div><h2 className="text-xl font-semibold">Share the moment.</h2><p className="mt-3 text-sm leading-6 text-[#65706d]">Send a room link and let people join without an account or a download.</p></div></div></section>
    </main>
  )
}

