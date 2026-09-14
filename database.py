import os
import uuid
from datetime import datetime
from sqlalchemy import (
    create_engine,
    Column,
    String,
    Float,
    Integer,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
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
    __tablename__ = "videos"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    youtube_url = Column(String(512), nullable=False)
    title = Column(String(255), nullable=True)
    duration = Column(Float, nullable=True)
    source_path = Column(String(1024), nullable=True)
    transcript_path = Column(String(1024), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    clips = relationship("ClipCandidate", back_populates="video", cascade="all, delete-orphan")


class ClipCandidate(Base):
    __tablename__ = "clip_candidates"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    video_id = Column(String(36), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False)
    rank_title = Column(String(255), nullable=False)
    emoji = Column(String(32), nullable=True)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    virality_score = Column(Integer, nullable=False, default=90)
    hook_sentence = Column(Text, nullable=True)

    video = relationship("Video", back_populates="clips")


class RenderedShort(Base):
    __tablename__ = "rendered_shorts"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    header_title = Column(String(255), nullable=False)
    selected_clip_ids = Column(JSON, nullable=False)
    output_file_path = Column(String(1024), nullable=False)
    assigned_channel = Column(String(255), nullable=True)
    is_uploaded = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class YouTubeChannel(Base):
    __tablename__ = "youtube_channels"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    channel_name = Column(String(255), nullable=False, unique=True)
    credentials_json_path = Column(String(1024), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
