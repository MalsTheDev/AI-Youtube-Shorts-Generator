import os
import uuid
import json
import glob
from datetime import datetime
from sqlalchemy import (
    create_engine,
    Column,
    String,
    Float,
    Integer,
    BigInteger,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
    text,
    inspect,
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "mysql+pymysql://root:password@127.0.0.1:3307/shorts_db"
)

engine = create_engine(
    DATABASE_URL,
    pool_recycle=3600,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Video(Base):
    """Source video entity (YouTube source, uploaded video)."""
    __tablename__ = "videos"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    youtube_url = Column(String(512), nullable=False)
    youtube_video_id = Column(String(64), nullable=True)
    title = Column(String(255), nullable=True)
    duration = Column(Float, nullable=True)
    category = Column(String(128), nullable=True, default="Family Guy")
    source_path = Column(String(1024), nullable=True)
    transcript_path = Column(String(1024), nullable=True)
    thumbnail_url = Column(String(512), nullable=True)
    user_prompt = Column(Text, nullable=True)

    # Pipeline tracking
    status = Column(String(32), default="completed")  # queued, downloading, downloaded, transcribing, transcribed, analyzing, completed, failed, cancelled
    current_stage = Column(String(32), default="completed")
    progress = Column(String(255), nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Legacy & V2 relationships
    legacy_candidates = relationship("ClipCandidate", back_populates="video", cascade="all, delete-orphan")
    clips = relationship("Clip", back_populates="source", cascade="all, delete-orphan")
    transcripts = relationship("Transcript", back_populates="source", cascade="all, delete-orphan")


class ClipCandidate(Base):
    """Legacy clip candidate model (maintained for full backwards compatibility)."""
    __tablename__ = "clip_candidates"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    video_id = Column(String(36), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False)
    rank_title = Column(String(255), nullable=False)
    emoji = Column(String(32), nullable=True)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    virality_score = Column(Integer, nullable=False, default=90)
    hook_sentence = Column(Text, nullable=True)
    category = Column(String(128), nullable=True, default="General")
    character_name = Column(String(128), nullable=True)
    tags = Column(Text, nullable=True)

    video = relationship("Video", back_populates="legacy_candidates")


class Clip(Base):
    """V2 Reusable Clip Entity.
    
    A discovered clip is an independent reusable asset that can appear
    in multiple productions without duplicating source video files.
    """
    __tablename__ = "clips"

    id = Column(String(64), primary_key=True, default=lambda: f"clip_{uuid.uuid4().hex[:12]}")
    source_id = Column(String(36), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    title = Column(String(255), nullable=False)
    original_title = Column(String(255), nullable=False)
    ai_score = Column(Integer, nullable=False, default=85)
    ai_reason = Column(Text, nullable=True)
    hook_sentence = Column(Text, nullable=True)
    emoji = Column(String(32), default="🔥")
    category = Column(String(128), default="General")
    character_name = Column(String(128), nullable=True)
    tags = Column(JSON, nullable=True)
    is_favorite = Column(Boolean, default=False)
    is_edited = Column(Boolean, default=False)
    is_archived = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    source = relationship("Video", back_populates="clips")
    production_clips = relationship("ProductionClip", back_populates="clip", cascade="all, delete-orphan")


class Transcript(Base):
    """Source transcript header."""
    __tablename__ = "transcripts"

    id = Column(String(64), primary_key=True, default=lambda: f"trans_{uuid.uuid4().hex[:10]}")
    source_id = Column(String(36), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False)
    language = Column(String(16), default="en")
    model = Column(String(64), default="whisper-base")
    version = Column(String(32), default="1.0")
    duration = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)

    source = relationship("Video", back_populates="transcripts")
    segments = relationship("TranscriptSegment", back_populates="transcript", cascade="all, delete-orphan", order_by="TranscriptSegment.start_time")


class TranscriptSegment(Base):
    """Detailed transcript segment with word-level timing data."""
    __tablename__ = "transcript_segments"

    id = Column(String(64), primary_key=True, default=lambda: f"seg_{uuid.uuid4().hex[:12]}")
    transcript_id = Column(String(64), ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    text = Column(Text, nullable=False)
    words_json = Column(JSON, nullable=True)

    transcript = relationship("Transcript", back_populates="segments")


class Production(Base):
    """A Production is a composition of clips intended to become one final video."""
    __tablename__ = "productions"

    id = Column(String(64), primary_key=True, default=lambda: f"prod_{uuid.uuid4().hex[:8]}")
    name = Column(String(255), nullable=False)
    template = Column(String(64), default="ranking")  # ranking, single_title
    aspect_ratio = Column(String(32), default="9:16")  # 9:16, 1:1, 16:9
    layout_mode = Column(String(32), default="1:1")
    title = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)
    hashtags = Column(JSON, nullable=True)
    caption_settings = Column(JSON, nullable=True)
    max_duration = Column(Float, default=60.0)
    transition_type = Column(String(64), default="swoosh")  # swoosh, black_screen
    countdown_order = Column(Boolean, default=False)  # True = 5,4,3,2,1 countdown; False = 1,2,3,4,5
    font_family = Column(String(64), default="minimal")  # minimal (Inter), anton (Meme / Impact bold)
    channel_handle = Column(String(255), nullable=True)
    status = Column(String(32), default="draft")  # draft, rendering, completed, failed
    render_progress = Column(String(255), nullable=True)
    render_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    clips = relationship("ProductionClip", back_populates="production", cascade="all, delete-orphan", order_by="ProductionClip.position")
    renders = relationship("Render", back_populates="production")


class ProductionClip(Base):
    """Join entity between Production and Clip with position and overrides."""
    __tablename__ = "production_clips"

    id = Column(String(64), primary_key=True, default=lambda: f"pclip_{uuid.uuid4().hex[:8]}")
    production_id = Column(String(64), ForeignKey("productions.id", ondelete="CASCADE"), nullable=False)
    clip_id = Column(String(64), ForeignKey("clips.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, default=0, nullable=False)
    custom_title = Column(String(255), nullable=True)
    start_override = Column(Float, nullable=True)
    end_override = Column(Float, nullable=True)

    production = relationship("Production", back_populates="clips")
    clip = relationship("Clip", back_populates="production_clips")


class Render(Base):
    """Rendered video output library record."""
    __tablename__ = "renders"

    id = Column(String(64), primary_key=True, default=lambda: f"render_{uuid.uuid4().hex[:8]}")
    production_id = Column(String(64), ForeignKey("productions.id", ondelete="SET NULL"), nullable=True)
    render_hash = Column(String(64), nullable=False)
    header_title = Column(String(255), nullable=False)
    output_file_path = Column(String(1024), nullable=False)
    file_size_bytes = Column(BigInteger, nullable=True)
    duration = Column(Float, nullable=True)
    template = Column(String(64), default="ranking")
    aspect_ratio = Column(String(32), default="9:16")
    is_preview = Column(Boolean, default=False)
    status = Column(String(32), default="completed")  # completed, failed
    created_at = Column(DateTime, default=datetime.utcnow)

    production = relationship("Production", back_populates="renders")


class RenderedShort(Base):
    """Legacy rendered shorts table (preserved for complete backward compatibility)."""
    __tablename__ = "rendered_shorts"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    header_title = Column(String(255), nullable=False)
    selected_clip_ids = Column(JSON, nullable=False)
    output_file_path = Column(String(1024), nullable=False)
    assigned_channel = Column(String(255), nullable=True)
    is_uploaded = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Idempotently initialize all database tables and perform non-destructive migrations."""
    # 1. First add any missing columns to existing tables
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        with engine.connect() as conn:
            if "videos" in tables:
                video_cols = {c["name"] for c in inspector.get_columns("videos")}
                new_video_cols = {
                    "youtube_video_id": "VARCHAR(64) NULL",
                    "status": "VARCHAR(32) DEFAULT 'completed'",
                    "current_stage": "VARCHAR(32) DEFAULT 'completed'",
                    "progress": "VARCHAR(255) NULL",
                    "started_at": "DATETIME NULL",
                    "completed_at": "DATETIME NULL",
                    "error_message": "TEXT NULL",
                    "thumbnail_url": "VARCHAR(512) NULL",
                    "category": "VARCHAR(128) DEFAULT 'Family Guy'",
                    "user_prompt": "TEXT NULL",
                }
                for col_name, col_def in new_video_cols.items():
                    if col_name not in video_cols:
                        conn.execute(text(f"ALTER TABLE videos ADD COLUMN {col_name} {col_def}"))
                        print(f"[db] Migrated videos: added {col_name} column", flush=True)

            if "clip_candidates" in tables:
                cand_cols = {c["name"] for c in inspector.get_columns("clip_candidates")}
                if "category" not in cand_cols:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN category VARCHAR(128) DEFAULT 'General'"))
                if "character_name" not in cand_cols:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN character_name VARCHAR(128) NULL"))
                if "tags" not in cand_cols:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN tags TEXT NULL"))

            if "productions" in tables:
                prod_cols = {c["name"] for c in inspector.get_columns("productions")}
                if "countdown_order" not in prod_cols:
                    conn.execute(text("ALTER TABLE productions ADD COLUMN countdown_order TINYINT(1) DEFAULT 0"))
                if "font_family" not in prod_cols:
                    conn.execute(text("ALTER TABLE productions ADD COLUMN font_family VARCHAR(64) DEFAULT 'minimal'"))
            conn.commit()
    except Exception as e:
        print(f"[db] Warning during schema column upgrade: {e}", flush=True)

    # 2. Create any missing tables (clips, transcripts, transcript_segments, productions, production_clips, renders)
    Base.metadata.create_all(bind=engine)

    # 3. Migrate data from clip_candidates -> clips safely
    db = SessionLocal()
    try:
        # Fill youtube_video_id on existing videos if missing
        videos = db.query(Video).all()
        for v in videos:
            if not v.youtube_video_id and v.youtube_url:
                yid = None
                if "v=" in v.youtube_url:
                    yid = v.youtube_url.split("v=")[1].split("&")[0]
                elif "youtu.be/" in v.youtube_url:
                    yid = v.youtube_url.split("youtu.be/")[1].split("?")[0]
                elif "source_" in v.youtube_url:
                    yid = os.path.basename(v.youtube_url).replace("source_", "").split(".")[0]
                if yid:
                    v.youtube_video_id = yid
        db.commit()

        # Migrate legacy clip candidates to new Clip table
        legacy_candidates = db.query(ClipCandidate).all()
        existing_clip_ids = {c.id for c in db.query(Clip.id).all()}
        migrated_clips = 0
        for cand in legacy_candidates:
            if cand.id not in existing_clip_ids:
                tags_list = None
                if cand.tags:
                    tags_list = [t.strip() for t in cand.tags.split(",") if t.strip()]
                new_clip = Clip(
                    id=cand.id,
                    source_id=cand.video_id,
                    start_time=cand.start_time,
                    end_time=cand.end_time,
                    title=cand.rank_title,
                    original_title=cand.rank_title,
                    ai_score=cand.virality_score,
                    hook_sentence=cand.hook_sentence,
                    emoji=cand.emoji or "🔥",
                    category=cand.category or "General",
                    character_name=cand.character_name,
                    tags=tags_list,
                    is_favorite=False,
                    is_edited=False,
                    is_archived=False,
                )
                db.add(new_clip)
                existing_clip_ids.add(cand.id)
                migrated_clips += 1
        if migrated_clips > 0:
            db.commit()
            print(f"[db] Successfully migrated {migrated_clips} legacy clip candidates to Clip entity.", flush=True)

        # Migrate legacy rendered shorts to new Render table
        legacy_renders = db.query(RenderedShort).all()
        existing_render_ids = {r.id for r in db.query(Render.id).all()}
        migrated_renders = 0
        for l_rend in legacy_renders:
            if l_rend.id not in existing_render_ids:
                fsize = None
                if l_rend.output_file_path and os.path.exists(l_rend.output_file_path):
                    try:
                        fsize = os.path.getsize(l_rend.output_file_path)
                    except Exception:
                        pass
                new_render = Render(
                    id=l_rend.id,
                    production_id=None,
                    render_hash=l_rend.id,
                    header_title=l_rend.header_title,
                    output_file_path=l_rend.output_file_path,
                    file_size_bytes=fsize,
                    duration=None,
                    template="ranking",
                    aspect_ratio="9:16",
                    is_preview=False,
                    status="completed",
                    created_at=l_rend.created_at or datetime.utcnow(),
                )
                db.add(new_render)
                existing_render_ids.add(l_rend.id)
                migrated_renders += 1
        if migrated_renders > 0:
            db.commit()
            print(f"[db] Successfully migrated {migrated_renders} legacy rendered shorts to Render entity.", flush=True)

        # Ingest existing transcripts from output/ if transcripts table is empty
        transcript_count = db.query(Transcript).count()
        if transcript_count == 0:
            output_dir = "output"
            json_transcripts = glob.glob(os.path.join(output_dir, "*.transcript.json"))
            ingested_transcripts = 0
            for t_path in json_transcripts:
                base = os.path.basename(t_path).replace(".transcript.json", "")
                v_match = db.query(Video).filter(
                    (Video.transcript_path.like(f"%{base}%")) |
                    (Video.source_path.like(f"%{base}%")) |
                    (Video.youtube_url.like(f"%{base.replace('source_', '')}%"))
                ).first()
                if v_match:
                    # check if transcript already exists for this video
                    existing_tr = db.query(Transcript).filter(Transcript.source_id == v_match.id).first()
                    if existing_tr:
                        continue
                    try:
                        with open(t_path, "r", encoding="utf-8") as f:
                            t_data = json.load(f)
                        tr_id = f"trans_{uuid.uuid4().hex[:10]}"
                        tr = Transcript(
                            id=tr_id,
                            source_id=v_match.id,
                            language=t_data.get("language", "en"),
                            model="whisper-base",
                            version="1.0",
                            duration=float(t_data.get("duration", 0.0)),
                        )
                        db.add(tr)
                        db.flush()

                        for idx, s in enumerate(t_data.get("segments", [])):
                            seg = TranscriptSegment(
                                id=f"seg_{uuid.uuid4().hex[:12]}",
                                transcript_id=tr.id,
                                start_time=float(s.get("start", 0.0)),
                                end_time=float(s.get("end", 0.0)),
                                text=s.get("text", "").strip(),
                                words_json=s.get("words", []),
                            )
                            db.add(seg)
                        db.commit()
                        ingested_transcripts += 1
                    except Exception as e:
                        db.rollback()
                        print(f"[db] Warning ingesting transcript {t_path}: {e}", flush=True)
            if ingested_transcripts > 0:
                print(f"[db] Ingested {ingested_transcripts} existing transcript files.", flush=True)

    except Exception as e:
        db.rollback()
        print(f"[db] Error during V2 data migration: {e}", flush=True)
    finally:
        db.close()
