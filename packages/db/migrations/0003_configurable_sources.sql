CREATE TABLE source_definitions (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  site_url TEXT NOT NULL,
  chapter_path_pattern TEXT NOT NULL,
  index_path_template TEXT NOT NULL,
  novel_id_template TEXT,
  chapter_id_template TEXT,
  chapter_link_selector TEXT NOT NULL,
  chapter_title_selector TEXT NOT NULL,
  chapter_title_exclude_selector TEXT,
  chapter_content_selector TEXT NOT NULL,
  chapter_content_start_selector TEXT,
  chapter_content_end_selector TEXT,
  chapter_content_end_text TEXT,
  chapter_content_exclude_selector TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO source_definitions(
  source_id,name,site_url,chapter_path_pattern,index_path_template,novel_id_template,chapter_id_template,
  chapter_link_selector,chapter_title_selector,chapter_title_exclude_selector,chapter_content_selector,
  chapter_content_start_selector,chapter_content_end_selector,chapter_content_end_text,chapter_content_exclude_selector,
  created_at,updated_at
) VALUES (
  'piaotia','Piaotia','https://www.piaotia.com','^/html/(\d+)/(\d+)/(\d+)\.html$','/html/{1}/{2}/index.html','{1}/{2}','{3}',
  '.centent ul li a','h1','a','body','.toplink ~ table','.bottomlink','翻页上AD开始','script,style,table,iframe,a',
  CAST(strftime('%s','now') AS INTEGER) * 1000,CAST(strftime('%s','now') AS INTEGER) * 1000
);
