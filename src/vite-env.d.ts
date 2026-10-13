/// <reference types="vite/client" />

declare module "*.asset.json" {
  const asset: {
    url: string;
    asset_id?: string;
    content_type?: string;
    original_filename?: string;
  };
  export default asset;
}
