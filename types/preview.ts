export interface PreviewItem {
  url: string;
  isImage: boolean;
  mimeType: string;
}

export interface FolderPreview {
  total: number;
  thumbnails: PreviewItem[];
}
