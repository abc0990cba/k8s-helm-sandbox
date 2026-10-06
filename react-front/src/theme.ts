import { createTheme } from "@mantine/core";

// system font stack on purpose: the cluster has no outbound internet, so no
// Google-webfont @import — the SPA must render fully offline
export const theme = createTheme({
  primaryColor: "teal",
  defaultRadius: "md",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'",
});
