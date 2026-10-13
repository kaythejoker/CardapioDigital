import Image, { getImageProps, type ImageProps } from "next/image";

// Reuse only the photographic regions of the supplied Brasa references.
// SVG clipping keeps the interface itself fully native, responsive and accessible.
const regions: [string, string][] = [
  ["picanha", "85 702 328 231"],
  ["risoto", "440 701 327 231"],
  ["pastel", "538 1138 227 145"],
  ["bolinho", "538 1316 227 145"],
  ["burrata", "538 1492 227 145"],
];
export function MenuPhoto({ slug, detail, ...props }: ImageProps & {slug: string; detail?: boolean}) {
  const matchesSeed = ["brasa-bistro", "brasa-demo"].includes(slug) && typeof props.src === "string" && props.src.includes("images.unsplash.com");
  const region = matchesSeed ? regions.find(([name]) => props.alt.toLowerCase().includes(name))?.[1] : undefined;
  const hero = matchesSeed && props.alt === "Salão do restaurante";
  if (!region && !hero) return <Image {...props} alt={props.alt}/>;
  const large = detail && props.alt.toLowerCase().includes("picanha");
  const viewBox = hero ? "520 185 268 239" : large ? "60 251 731 373" : region;
  const { props: optimized } = getImageProps({src: large ? "/reference-photos/brasa-detail.png" : "/reference-photos/brasa-menu.png", alt: "", width: 852, height: 1846, quality: 75});
  return <svg role="img" aria-label={props.alt || undefined} aria-hidden={!props.alt} viewBox={viewBox} preserveAspectRatio="xMidYMid slice" className={props.className} style={{width:props.fill ? "100%" : props.width || "100%",height:props.fill ? "100%" : props.height || "100%",display:"block",flexShrink:0,...(props.fill ? {position:"absolute",inset:0} : {}),...props.style}}><image href={optimized.src} width="852" height="1846"/></svg>;
}
