/**
 * pageTurn.ts — the editor follows the playback a page at a time.
 *
 * Scrolling with every bar makes the text crawl, which is hard to read. So the
 * view holds still until the note being followed gets near the bottom (or
 * leaves the view), then glides it to the top in one move, the way you turn
 * a page of sheet music. When several tracks sound in different parts of the
 * file, it follows the tune; while the tune rests it stays put, and only a
 * longer silence hands the page to the accompaniment.
 *
 * It stops for good once you scroll or type in the editor yourself
 * (follow.ts); `resume` turns it back on.
 */
import type { EditorView } from '@codemirror/view';
import { easeInOut, watchManualScroll } from './follow';

/** Turn the page when the followed note passes this far down the view… */
const TURN_AT = 0.85;
/** …and land it this far from the top. */
const LAND_AT = 0.1;
const TURN_MS = 550;
/** How long the tune may rest before the page follows the other tracks. */
const LEAD_REST_MS = 4000;

export interface FollowedSpan {
  from: number;
  to: number;
  /** Part of the tune. */
  lead: boolean;
}

export class PageTurner {
  following = true;
  private anim: { from: number; to: number; t0: number } | null = null;
  private leadAt = -Infinity;
  private unwatch: () => void;

  constructor(
    private view: EditorView,
    /** Told when following stops because you took over. */
    private onStop: () => void,
  ) {
    this.unwatch = watchManualScroll(view.scrollDOM, () => this.stop(), { anyKey: true, anyPointer: true });
  }

  /** Follow again (a new play, or the Follow button). */
  resume() {
    this.following = true;
    this.leadAt = -Infinity;
  }

  private stop() {
    if (!this.following) return;
    this.following = false;
    this.anim = null;
    this.onStop();
  }

  /** One frame of playback: what sounds now, and the frame's time (ms). */
  frame(spans: FollowedSpan[], now: number) {
    if (!this.following) return;
    const sd = this.view.scrollDOM;
    const h = sd.clientHeight;
    if (!h) return; // the Editor tab is hidden
    if (this.anim) {
      const k = Math.min(1, (now - this.anim.t0) / TURN_MS);
      sd.scrollTop = this.anim.from + (this.anim.to - this.anim.from) * easeInOut(k);
      if (k >= 1) this.anim = null;
      return;
    }
    const lead = spans.filter((s) => s.lead);
    let pick: FollowedSpan[];
    if (lead.length) {
      pick = lead;
      this.leadAt = now;
    } else if (now - this.leadAt < LEAD_REST_MS) {
      return;
    } else {
      pick = spans;
    }
    if (!pick.length) return;

    const pad = this.view.documentPadding.top;
    const blocks = pick.map((s) => this.view.lineBlockAt(s.from));
    const top = Math.min(...blocks.map((b) => b.top)) + pad;
    const bottom = Math.max(...blocks.map((b) => b.bottom)) + pad;
    const at = sd.scrollTop;
    if (bottom - at <= h * TURN_AT && top - at >= 0) return;
    const to = Math.max(0, Math.min(sd.scrollHeight - h, top - h * LAND_AT));
    if (Math.abs(to - at) > 4) this.anim = { from: at, to, t0: now };
  }

  destroy() {
    this.unwatch();
  }
}
