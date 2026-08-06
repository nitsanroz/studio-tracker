"use client";

import {
  Bug,
  Building2,
  Camera,
  CheckCircle2,
  Circle,
  Compass,
  Flame,
  Gem,
  Globe,
  Heart,
  Layers,
  Leaf,
  Lightbulb,
  Megaphone,
  Monitor,
  Music,
  Palette,
  Rocket,
  Settings,
  ShoppingBag,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Client } from "@/lib/types";

/**
 * The preset client marks (migration 0023). Stored by NAME, not by component —
 * a column holding "rocket" survives an icon-library upgrade, whereas one
 * holding a rendered SVG would freeze today's artwork into the database.
 *
 * Anything not in this map falls back to the client's initial, so removing an
 * icon from the set can never leave a client with a blank square.
 */
export const CLIENT_ICONS: Record<string, LucideIcon> = {
  rocket: Rocket,
  sparkles: Sparkles,
  star: Star,
  heart: Heart,
  zap: Zap,
  flame: Flame,
  gem: Gem,
  palette: Palette,
  camera: Camera,
  music: Music,
  globe: Compass,
  world: Globe,
  leaf: Leaf,
  lightbulb: Lightbulb,
  megaphone: Megaphone,
  monitor: Monitor,
  layers: Layers,
  building: Building2,
  shop: ShoppingBag,
  users: Users,
  trend: TrendingUp,
  check: CheckCircle2,
  settings: Settings,
  bug: Bug,
  circle: Circle,
};

export const CLIENT_ICON_NAMES = Object.keys(CLIENT_ICONS);

/**
 * A client's mark: an uploaded image if there is one, else a preset glyph, else
 * the initial. Colour always comes from `client.color`, so a client stays
 * recognisable at a glance even before anyone picks an icon for it.
 *
 * The glyph is drawn in white on the client's colour rather than in the colour
 * on white: at 20–28px a coloured line icon on a pale disc loses to the text
 * beside it, which is the opposite of what an avatar is for.
 */
export function ClientAvatar({
  client,
  size = 24,
  className = "",
}: {
  client: Pick<Client, "name" | "color" | "icon" | "iconUrl">;
  size?: number;
  className?: string;
}) {
  const Icon = client.icon ? CLIENT_ICONS[client.icon] : undefined;
  const common = "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg";

  if (client.iconUrl) {
    return (
      // object-contain with padding: an uploaded mark is a logo, and cropping a
      // logo to fill a square is how you turn it into someone else's logo.
      <span
        className={`${common} ${className}`}
        style={{ width: size, height: size, backgroundColor: client.color }}
        title={client.name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Supabase storage URL, no loader configured */}
        <img
          src={client.iconUrl}
          alt=""
          className="size-full object-contain p-[15%]"
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span
      className={`${common} font-semibold text-white ${className}`}
      style={{ width: size, height: size, backgroundColor: client.color, fontSize: size * 0.45 }}
      title={client.name}
    >
      {Icon ? <Icon size={Math.round(size * 0.56)} strokeWidth={2} /> : client.name.charAt(0).toUpperCase()}
    </span>
  );
}
