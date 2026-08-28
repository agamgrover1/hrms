import { useEffect, useState } from 'react';
import { Download, Share as ShareIcon, Plus, ChevronDown } from 'lucide-react';
import { toast } from './Toaster';

// InstallAppChip
//
// Chrome / Edge / Android fire a `beforeinstallprompt` event when the
// PWA meets install criteria (valid manifest + service worker + HTTPS).
// The event is stashed and prompt() is called on user gesture.
//
// Safari (macOS + iOS) doesn't support this event at all — install is
// via Share → Add to Home Screen / Add to Dock. We detect Safari and
// render an "Install" chip that opens a tiny how-to instead.
//
// Once installed (display-mode: standalone) we hide the chip.

type Deferred = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const DISMISS_KEY = 'hrms_install_prompt_dismissed';

function isStandalone(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if ((navigator as any).standalone === true) return true;   // iOS Safari
  } catch { /* private mode */ }
  return false;
}
function isSafari(): boolean {
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua);
}
// iOS detection needs care: iPadOS 13+ reports as "MacIntel" on
// touch-capable devices. Also detect Chrome-on-iOS / Firefox-on-iOS
// (both use WebKit under the hood — PWA install path is the same).
function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/i.test(ua)) return true;
  if (/iPad/i.test(ua)) return true;
  const isTouchMac = /Macintosh/i.test(ua) && typeof navigator !== 'undefined' && (navigator as any).maxTouchPoints > 1;
  return isTouchMac;
}

export default function InstallAppChip() {
  const [deferred, setDeferred] = useState<Deferred | null>(null);
  const [showSafariHint, setShowSafariHint] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [safariHelp, setSafariHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) { setHidden(true); return; }
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') { setHidden(true); return; }
    } catch { /* noop */ }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as Deferred);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

    const onInstalled = () => {
      setHidden(true);
      setDeferred(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    // Safari path — no beforeinstallprompt fires, so we opt to render
    // the chip anyway (it opens a Share-menu how-to on click).
    if (isSafari()) setShowSafariHint(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome === 'accepted') {
          setHidden(true);
          toast.success('Installed', 'Digital Leap HRMS is now in your dock.');
        }
        setDeferred(null);
      } catch (e: any) {
        toast.error('Install failed', e?.message ?? 'Please try again.');
      }
      return;
    }
    if (isSafari()) { setSafariHelp(true); return; }
    // No deferred event, not Safari — usually already installed or
    // browser doesn't support PWA install (rare on desktop). Hide.
    setHidden(true);
  };

  const dismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
    setHidden(true);
  };

  if (hidden) return null;
  if (!deferred && !showSafariHint) return null;

  return (
    <>
      <div className="inline-flex items-center gap-1 h-9 pl-2.5 pr-1 rounded-full border border-brand/40 bg-brand-container/40 text-on-brand-container text-xs sm:text-sm font-semibold">
        <Download size={12} />
        <button onClick={install}
          className="px-1.5 hover:underline">
          Install app
        </button>
        <button onClick={dismiss} title="Not now"
          className="px-1.5 text-on-brand-container/60 hover:text-on-brand-container text-[10px]">
          ×
        </button>
      </div>

      {safariHelp && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-3" onClick={() => setSafariHelp(false)}>
          <div onClick={e => e.stopPropagation()}
            className="bg-surface rounded-xl-2 p-5 w-full max-w-sm border border-outline shadow-elev-4 space-y-4">
            <h3 className="text-base font-display font-bold text-on-surface flex items-center gap-2">
              <Download size={14} className="text-accent" />
              {isIos() ? 'Add to Home Screen' : 'Install on Safari'}
            </h3>

            {isIos() ? (
              <>
                {/* iPhone / iPad — the ONLY install path is Share → Add to
                    Home Screen. "Add to Dock" doesn't exist on iOS. */}
                <ol className="text-sm text-on-surface-muted space-y-3">
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center">1</span>
                    <span>
                      Tap the <b className="text-on-surface inline-flex items-center gap-1">Share <ShareIcon size={12} className="inline"/></b> button. On iPhone it's at the bottom of Safari; on iPad it's at the top-right.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center">2</span>
                    <span>
                      Scroll down and tap <b className="text-on-surface inline-flex items-center gap-1"><Plus size={12} className="inline"/> Add to Home Screen</b>. If you don't see it, tap <b className="text-on-surface inline-flex items-center gap-1">Edit Actions <ChevronDown size={12} className="inline"/></b> at the bottom of the share sheet and turn it on.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center">3</span>
                    <span>
                      Tap <b className="text-on-surface">Add</b> in the top-right. The HRMS icon appears on your home screen and opens like a native app.
                    </span>
                  </li>
                </ol>
                <div className="rounded-lg border border-outline/60 bg-surface-2 p-2.5 space-y-1">
                  <p className="text-[11px] text-on-surface-muted"><b className="text-on-surface">Must use Safari</b> — Chrome/Firefox on iOS can't install PWAs (Apple restriction).</p>
                  <p className="text-[11px] text-on-surface-subtle">Push notifications only work after installing this way (iOS 16.4+).</p>
                </div>
              </>
            ) : (
              <>
                <ol className="text-sm text-on-surface-muted space-y-1.5 list-decimal pl-5">
                  <li>Click the <b className="text-on-surface">Share</b> button in Safari's toolbar (square with an arrow).</li>
                  <li>Choose <b className="text-on-surface">Add to Dock</b>. macOS Sonoma or newer required.</li>
                  <li>Rename if you like → <b className="text-on-surface">Add</b>. The app opens in its own window from now on.</li>
                </ol>
                <p className="text-[11px] text-on-surface-subtle">On older macOS versions, keep this tab pinned instead.</p>
              </>
            )}

            <div className="flex justify-end">
              <button onClick={() => setSafariHelp(false)}
                className="px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold">Got it</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
