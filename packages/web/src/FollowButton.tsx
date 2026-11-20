import { LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Shown while a song plays and the view has stopped following it: one click brings it back. */
export default function FollowButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="secondary" className="absolute bottom-4 right-5 z-10 shadow-lg shadow-black/40" onClick={onClick}>
      <LocateFixed />
      Follow playback
    </Button>
  );
}
