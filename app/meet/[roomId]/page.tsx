import MeetingRoom from '@/components/meeting-room'

export default async function MeetPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params
  return <MeetingRoom roomId={decodeURIComponent(roomId)} />
}
