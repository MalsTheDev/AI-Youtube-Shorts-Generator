import os
import glob
import json
import uuid
from database import SessionLocal, Video, ClipCandidate, RenderedShort, YouTubeChannel

OUTPUT_DIR = "output"

def seed_existing():
    db = SessionLocal()
    try:
        # 1. Seed a default YouTube Channel if none exist
        chan = db.query(YouTubeChannel).first()
        if not chan:
            c1 = YouTubeChannel(
                id=str(uuid.uuid4()),
                channel_name="Top Viral Highlights @MalsTheDev",
                credentials_json_path="credentials/malsthedev_oauth.json",
            )
            c2 = YouTubeChannel(
                id=str(uuid.uuid4()),
                channel_name="Cartoon Best Moments @MalsShorts",
                credentials_json_path="credentials/malsshorts_oauth.json",
            )
            db.add_all([c1, c2])
            db.commit()
            print("Seeded sample YouTube channels.")

        # 2. Seed existing videos from output/
        transcripts = glob.glob(os.path.join(OUTPUT_DIR, "*.transcript.json"))
        print(f"Found {len(transcripts)} transcripts in {OUTPUT_DIR}")

        for t_file in transcripts:
            base = os.path.basename(t_file).replace(".transcript.json", "")
            mp4_file = os.path.join(OUTPUT_DIR, f"{base}.mp4")
            if not os.path.exists(mp4_file):
                continue

            with open(t_file, "r", encoding="utf-8") as f:
                t_data = json.load(f)

            yt_id = base.replace("source_", "")
            yt_url = f"https://www.youtube.com/watch?v={yt_id}"
            
            # Check if video already exists
            v = db.query(Video).filter(Video.youtube_url == yt_url).first()
            if not v:
                title_map = {
                    "eiHklQvqLYw": "Family Guy - Best Stewie & Peter Compilation",
                    "HycoJNJWmxI": "Family Guy - Funniest Random Moments Ranking",
                    "ssVHdM3263Q": "Family Guy - Epic Quagmire & Brian Cutaways",
                    "VRlzhrUsxVQ": "Family Guy - Top Unhinged Moments Season 12",
                    "Xas1acxbOPE": "Family Guy - Road to the Multiverse Highlights",
                }
                v_title = title_map.get(yt_id, f"YouTube Video: {yt_id}")
                v = Video(
                    id=str(uuid.uuid4()),
                    youtube_url=yt_url,
                    title=v_title,
                    duration=float(t_data.get("duration", 60.0)),
                    source_path=os.path.abspath(mp4_file),
                    transcript_path=os.path.abspath(t_file),
                )
                db.add(v)
                db.flush()

                # Add 3-5 high virality clip candidates from segments
                segments = t_data.get("segments", [])
                if len(segments) >= 3:
                    # Pick 3 interesting segments as clips
                    indices = [0, len(segments) // 2, max(0, len(segments) - 2)]
                    for idx, s_idx in enumerate(indices):
                        seg = segments[s_idx]
                        c = ClipCandidate(
                            id=f"{yt_id}_c{idx+1}",
                            video_id=v.id,
                            rank_title=f"Hilarious Scene #{idx+1} ({seg.get('text', '')[:30]}...)",
                            emoji="🔥" if idx == 0 else "😂",
                            start_time=float(seg.get("start", 0.0)),
                            end_time=float(min(seg.get("start", 0.0) + 25.0, seg.get("end", 30.0))),
                            virality_score=95 - idx * 3,
                            hook_sentence=seg.get("text", "")[:80],
                        )
                        db.add(c)

        # 3. Seed sample RenderedShort if final_short.mp4 exists
        if os.path.exists("output/final_short.mp4"):
            existing_rs = db.query(RenderedShort).first()
            if not existing_rs:
                rs = RenderedShort(
                    id=str(uuid.uuid4()),
                    header_title="RANKING FUNNIEST FAMILY GUY MOMENTS",
                    selected_clip_ids=["clip_1", "clip_2", "clip_3"],
                    output_file_path=os.path.abspath("output/final_short.mp4"),
                    assigned_channel="Top Viral Highlights @MalsTheDev",
                    is_uploaded=False,
                )
                db.add(rs)

        db.commit()
        print("Database seeding completed successfully!")
    finally:
        db.close()

if __name__ == "__main__":
    seed_existing()
