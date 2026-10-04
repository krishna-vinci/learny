/** File description pages and image bytes belong to save_asset, not the source registry. */
export function isImageSourceUrl(url: URL): boolean {
  const pathname = decodeURIComponent(url.pathname);
  return (
    /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|tiff?)(?:$|\/)/i.test(pathname) ||
    (/\.(?:wikimedia|wikipedia)\.org$/i.test(url.hostname) &&
      /(?:\/wiki\/|\/w\/index\.php).*File:/i.test(`${pathname}${url.search}`))
  );
}
