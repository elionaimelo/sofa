import { useEffect, useRef, useState } from "react";
import {
  UsersThreeIcon,
  ChatCircleDotsIcon,
  ArrowClockwiseIcon,
  SignOutIcon,
  ArrowUpRightIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { Translate } from "../i18n";
import { Dialog } from "../components/Dialog";
import {
  desktop,
  navigateControls,
  serviceError,
  useFeatureInput,
  type InputRef,
} from "../services";
type Friend = {
  steamid: string;
  personaname: string;
  avatarfull: string;
  personastate: number;
  gameextrainfo: string | null;
  gameid: string | null;
};
export function Friends({
  t,
  input,
  onBack,
}: {
  t: Translate;
  input: InputRef;
  onBack: () => void;
}) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [key, setKey] = useState("");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"allFriends" | "online">("allFriends");
  const [selected, setSelected] = useState<Friend | null>(null);
  const root = useRef<HTMLElement>(null);
  const request = useRef(0);
  useEffect(() => {
    let alive = true;
    desktop<Friend[]>("refresh_friends")
      .then((list) => {
        if (alive) setFriends(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
      request.current++;
    };
  }, []);
  const load = async (connect = false) => {
    if (busy) return;
    if (
      connect &&
      (!/^\d{17}$/.test(id.trim()) || !/^[a-fA-F0-9]{32}$/.test(key.trim()))
    ) {
      setError("invalidSteamAccount");
      return;
    }
    setBusy(true);
    setError("");
    const token = ++request.current;
    try {
      const list = await desktop<Friend[]>(
        connect ? "connect_friends" : "refresh_friends",
        connect ? { key: key.trim(), steamId: id.trim() } : undefined,
      );
      if (token === request.current) {
        setFriends(list);
        setKey("");
      }
    } catch (e) {
      if (token === request.current)
        setError(
          String(e) === "desktopRequired" ? "desktopRequired" : serviceError(e),
        );
    } finally {
      if (token === request.current) setBusy(false);
    }
  };
  const open = async (target: string, friendId?: string) => {
    setError("");
    try {
      await desktop("open_social", { target, id: friendId ?? null });
    } catch (e) {
      setError(
        String(e) === "desktopRequired" ? "desktopRequired" : serviceError(e),
      );
    }
  };
  const disconnect = async () => {
    try {
      await desktop("disconnect_friends");
      request.current++;
      setFriends(null);
      setKey("");
      setId("");
      setError("");
      setSelected(null);
    } catch (e) {
      setError(serviceError(e));
    }
  };
  useFeatureInput(input, (a) => {
    if (a === "b") {
      if (selected) setSelected(null);
      else onBack();
      return;
    }
    if (selected) {
      navigateControls(a, document.querySelector("dialog[open]"));
      return;
    }
    if ((a === "lb" || a === "rb") && friends) {
      setFilter((f) => (f === "online" ? "allFriends" : "online"));
      return;
    }
    if (a === "y" && friends) {
      void load();
      return;
    }
    navigateControls(a, root.current);
  });
  const visible =
    friends?.filter((f) => filter === "allFriends" || f.personastate > 0) ?? [];
  return (
    <section
      className="feature-page friends-page"
      ref={root}
      id="content"
      tabIndex={-1}
    >
      <div className="feature-heading">
        <div>
          <p className="eyebrow">{t("friends")}</p>
          <h1>{t("friendsIntro")}</h1>
          <p className="feature-description">{t("chatNote")}</p>
        </div>
        {friends && (
          <div className="detail-actions">
            <button
              disabled={busy}
              onClick={() => void load()}
              aria-label={t("refreshFriends")}
            >
              <ArrowClockwiseIcon />
            </button>
            <button disabled={busy} onClick={() => void disconnect()}>
              <SignOutIcon />
              {t("disconnect")}
            </button>
          </div>
        )}
      </div>
      {!friends ? (
        <div className="account-connect">
          <div className="account-illustration">
            <UsersThreeIcon size={100} weight="duotone" />
            <h2>Steam</h2>
            <p>{t("steamPrivacy")}</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load(true);
            }}
          >
            <h2>{t("connectSteam")}</h2>
            <label>
              {t("steamId")}
              <input
                required
                inputMode="numeric"
                maxLength={17}
                pattern="[0-9]{17}"
                value={id}
                onChange={(e) => setId(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              {t("steamKey")}
              <input
                required
                type="password"
                minLength={32}
                maxLength={32}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button type="submit" className="accent" disabled={busy}>
              {t(busy ? "connecting" : "connectSteam")}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => void open("key")}
            >
              {t("getKey")}
              <ArrowUpRightIcon />
            </button>
          </form>
        </div>
      ) : (
        <>
          <nav className="segmented" aria-label={t("friends")}>
            {(["allFriends", "online"] as const).map((f) => (
              <button
                key={f}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {t(f)}
                {f === "allFriends" && <span>{friends.length}</span>}
              </button>
            ))}
          </nav>
          {!visible.length ? (
            <div className="feature-empty">
              <UsersThreeIcon size={48} />
              <h2>{t("noFriends")}</h2>
            </div>
          ) : (
            <div className="friend-list">
              {visible.map((f) => (
                <button
                  className="friend-card"
                  key={f.steamid}
                  onClick={() => setSelected(f)}
                >
                  <img
                    src={f.avatarfull}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                  <span>
                    <strong>{f.personaname}</strong>
                    <span
                      className={
                        f.gameid
                          ? "playing-label"
                          : f.personastate > 0
                            ? "online-label"
                            : "muted"
                      }
                    >
                      {f.gameextrainfo
                        ? t("playing", { title: f.gameextrainfo })
                        : t(f.personastate > 0 ? "online" : "offline")}
                    </span>
                  </span>
                  <ChatCircleDotsIcon size={22} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {t(error as Parameters<Translate>[0])}
        </p>
      )}
      {selected && (
        <Dialog label={selected.personaname} onClose={() => setSelected(null)}>
          <div className="settings-head">
            <h1>{selected.personaname}</h1>
            <button onClick={() => setSelected(null)} aria-label={t("close")}>
              <XIcon />
            </button>
          </div>
          <div className="friend-detail">
            <img src={selected.avatarfull} alt="" />
            <div>
              <p>
                {selected.gameextrainfo
                  ? t("playing", { title: selected.gameextrainfo })
                  : t(selected.personastate > 0 ? "online" : "offline")}
              </p>
              <div className="detail-actions">
                <button
                  data-initial-focus
                  className="accent"
                  onClick={() => void open("chat")}
                >
                  <ChatCircleDotsIcon />
                  {t("openChat")}
                </button>
                <button onClick={() => void open("profile", selected.steamid)}>
                  {t("openProfile")}
                  <ArrowUpRightIcon />
                </button>
              </div>
              <p className="muted">{t("chatNote")}</p>
              {error && (
                <p role="alert">{t(error as Parameters<Translate>[0])}</p>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
