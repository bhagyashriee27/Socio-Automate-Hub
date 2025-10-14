import os
import json
import time as sleep
import mysql.connector
from dotenv import load_dotenv
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.errors import HttpError
import io
import re
import sys
import subprocess
from datetime import datetime, timedelta
import pytz

# Load environment variables from .env
load_dotenv()

# Database configuration
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "database": os.getenv("DB_DATABASE"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT"))
}

# Google OAuth client secrets
CLIENT_SECRETS = {
    "installed": {
        "client_id": os.getenv("GOOGLE_CLIENT_ID"),
        "project_id": os.getenv("GOOGLE_PROJECT_ID"),
        "auth_uri": os.getenv("GOOGLE_AUTH_URI"),
        "token_uri": os.getenv("GOOGLE_TOKEN_URI"),
        "auth_provider_x509_cert_url": os.getenv("GOOGLE_AUTH_PROVIDER_X509_CERT_URL"),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
        "redirect_uris": [os.getenv("GOOGLE_REDIRECT_URIS")]
    }
}

# OAuth 2.0 scopes
YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"]
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# Supported video file extensions
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".wmv", ".flv"}

# Configuration
TEMP_FOLDER = "vid_yt_upload"
ACTIVE_COUNTDOWN_SECONDS = 300
IDLE_SLEEP_MINUTES = 0.3
RESCHEDULE_THRESHOLD_MINUTES = 15
over_time = 1

# --- User-Friendly Logging Functions ---
def print_step(message):
    print(f"→ {message}")

def print_success(message):
    print(f"✓ {message}")

def print_error(message):
    print(f"✗ {message}")

def print_warning(message):
    print(f"⚠ {message}")

def print_info(message):
    print(f"ℹ {message}")

def print_header(title):
    print(f"\n{'━' * 60}")
    print(f" {title}")
    print(f"{'━' * 60}")

def print_countdown(message):
    print(f"⏰ {message}", end='\r')

# --- Database Functions ---
def get_db_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print_error(f"Database connection failed: {str(e)}")
        return None

def get_next_scheduled_youtube():
    """Get the next scheduled YouTube channel to post."""
    conn = get_db_connection()
    if not conn:
        return None
    cursor = conn.cursor(dictionary=True)
    query = """
        SELECT 
            y.id, y.user_id, y.username, y.channel_id, y.token_sesson, 
            y.google_drive_link, y.next_post_time, y.posts_left,
            y.custom_schedule_data, y.post_daily_range_left,
            u.Name AS user_name
        FROM youtube y
        JOIN user u ON y.user_id = u.Id
        WHERE y.selected = 'Yes' AND y.done = 'No' AND y.posts_left > 0 AND y.next_post_time IS NOT NULL
        ORDER BY y.next_post_time ASC
        LIMIT 1
    """
    cursor.execute(query)
    channel = cursor.fetchone()
    cursor.close()
    conn.close()
    return channel

def debug_schedule_data_youtube(channel_id):
    """Debug function to see all scheduled media for YouTube"""
    conn = get_db_connection()
    if not conn:
        return
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT custom_schedule_data, next_post_time FROM youtube WHERE id = %s", (channel_id,))
    result = cursor.fetchone()
    cursor.close()
    conn.close()
    
    if result and result['custom_schedule_data']:
        try:
            schedule_data = json.loads(result['custom_schedule_data'])
            print("\n--- DEBUG: All Scheduled Media (YouTube) ---")
            for i, media in enumerate(schedule_data):
                print(f"  {i+1}. {media.get('media_name')} | Type: {media.get('schedule_type')} | Status: {media.get('status')} | Time: {media.get('scheduled_datetime')}")
            print(f"  Next Post Time: {result['next_post_time']}")
            print("--- END DEBUG ---\n")
        except json.JSONDecodeError:
            print("  DEBUG: Invalid schedule data")

def get_scheduled_media_for_youtube(channel_id):
    """Get the next scheduled media file for this YouTube channel that should be posted now"""
    conn = get_db_connection()
    if not conn:
        return None
    cursor = conn.cursor(dictionary=True)
    
    # Get custom_schedule_data AND next_post_time to understand what type of post is scheduled
    cursor.execute("SELECT custom_schedule_data, next_post_time FROM youtube WHERE id = %s", (channel_id,))
    result = cursor.fetchone()
    cursor.close()
    conn.close()
    
    if not result or not result['custom_schedule_data']:
        return None
    
    try:
        schedule_data = json.loads(result['custom_schedule_data'])
        now = datetime.now(pytz.timezone('Asia/Kolkata'))
        next_post_time = result['next_post_time']
        
        print(f"  Debug: Looking for scheduled media. Next post time: {next_post_time}")
        
        # If we have a next_post_time, find which media matches it
        if next_post_time:
            next_post_time = make_aware(next_post_time)
            
            # First, look for datetime posts that match the next_post_time
            for media in schedule_data:
                if (media.get('status') == 'pending' and 
                    media.get('schedule_type') == 'datetime' and 
                    media.get('scheduled_datetime')):
                    try:
                        scheduled_time = datetime.strptime(media['scheduled_datetime'], '%Y-%m-%d %H:%M:%S')
                        scheduled_time = pytz.timezone('Asia/Kolkata').localize(scheduled_time)
                        
                        # If this datetime post matches the scheduled time (within 2 minutes)
                        if abs((scheduled_time - next_post_time).total_seconds()) <= 120:
                            print(f"  Debug: Found matching datetime post: {media.get('media_name')}")
                            return media
                    except ValueError:
                        continue
            
            # If no datetime post matches, look for range posts
            for media in schedule_data:
                if (media.get('status') == 'pending' and 
                    media.get('schedule_type') == 'range'):
                    print(f"  Debug: Found range post: {media.get('media_name')}")
                    return media
        
        # Fallback: if no next_post_time or no match found, use the logic from before
        for media in schedule_data:
            if media.get('status') == 'pending':
                if media.get('schedule_type') == 'datetime' and media.get('scheduled_datetime'):
                    try:
                        scheduled_time = datetime.strptime(media['scheduled_datetime'], '%Y-%m-%d %H:%M:%S')
                        scheduled_time = pytz.timezone('Asia/Kolkata').localize(scheduled_time)
                        if abs((scheduled_time - now).total_seconds()) <= 120:
                            return media
                    except ValueError:
                        continue
                elif media.get('schedule_type') == 'range':
                    return media
                    
    except json.JSONDecodeError:
        return None
    
    return None

def update_channel_after_post(channel_id, media_file_id):
    """Update YouTube channel after successful post - update specific media status and counters"""
    conn = get_db_connection()
    if not conn:
        return False
    
    try:
        cursor = conn.cursor(dictionary=True)
        
        # Get current data
        cursor.execute("SELECT custom_schedule_data, posts_left, post_daily_range_left FROM youtube WHERE id = %s", (channel_id,))
        result = cursor.fetchone()
        
        if not result:
            return False
        
        # Update the specific media status to 'completed'
        schedule_data = json.loads(result['custom_schedule_data']) if result['custom_schedule_data'] else []
        for media in schedule_data:
            if media.get('file_id') == media_file_id:
                media['status'] = 'completed'
                break
        
        # Update counters
        new_posts_left = result['posts_left'] - 1
        new_daily_range_left = max(0, result['post_daily_range_left'] - 1) if result['post_daily_range_left'] is not None else 0
        done_status = 'Yes' if new_posts_left <= 0 else 'No'
        
        # Update database
        update_query = """
            UPDATE youtube 
            SET custom_schedule_data = %s, 
                posts_left = %s, 
                post_daily_range_left = %s,
                selected = 'No', 
                done = %s, 
                next_post_time = NULL 
            WHERE id = %s
        """
        cursor.execute(update_query, (
            json.dumps(schedule_data), 
            new_posts_left, 
            new_daily_range_left, 
            done_status, 
            channel_id
        ))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print_success(f"YouTube Channel ID {channel_id} updated:")
        print_info(f"  - Media {media_file_id} status updated to 'completed'")
        print_info(f"  - posts_left: {result['posts_left']} → {new_posts_left}")
        print_info(f"  - post_daily_range_left: {result['post_daily_range_left']} → {new_daily_range_left}")
        print_info(f"  - done: '{done_status}'")
        
        return True
        
    except Exception as e:
        print_error(f"ERROR updating database for YouTube channel {channel_id}: {str(e)}")
        conn.rollback()
        cursor.close()
        conn.close()
        return False

def get_drive_token_from_db(user_id):
    """Retrieve token_drive from the instagram table."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT token_drive FROM instagram WHERE user_id = %s", (user_id,))
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        if result and result[0]:
            try:
                token_str = result[0].strip('"').replace('\\"', '"').replace("\\'", "'")
                return json.loads(token_str)
            except json.JSONDecodeError:
                print_error("Invalid JSON in token_drive")
                return None
        print_warning(f"No token_drive found for user_id={user_id}")
        return None
    except mysql.connector.Error as e:
        print_error(f"Failed to load token_drive: {str(e)}")
        return None

def save_drive_token_to_db(user_id, token_data):
    """Save refreshed token_drive to the instagram table."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        token_json = json.dumps(token_data)
        cursor.execute("UPDATE instagram SET token_drive = %s WHERE user_id = %s", (token_json, user_id))
        conn.commit()
        cursor.close()
        conn.close()
        print_success("Drive token saved")
    except mysql.connector.Error as e:
        print_error(f"Failed to save Drive token: {str(e)}")

def save_token_to_db(user_id, token_data):
    """Save token data to the youtube table."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        token_json = json.dumps(token_data)
        cursor.execute("UPDATE youtube SET token_sesson = %s WHERE user_id = %s", (token_json, user_id))
        conn.commit()
        cursor.close()
        conn.close()
        print_success("YouTube token saved")
    except mysql.connector.Error as e:
        print_error(f"Failed to save token: {str(e)}")

def load_token_from_db(user_id):
    """Load token data from the youtube table."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT token_sesson FROM youtube WHERE user_id = %s", (user_id,))
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        if result and result[0]:
            try:
                return json.loads(result[0])
            except json.JSONDecodeError:
                print_error("Invalid JSON in token_sesson")
                return None
        return None
    except mysql.connector.Error as e:
        print_error(f"Failed to load token: {str(e)}")
        return None

# --- Authentication Functions ---
def authenticate_youtube(user_id):
    """Authenticate and create a YouTube API client."""
    creds = None
    token_file = f"token_{user_id}.json"

    # Try loading from database first
    token_data = load_token_from_db(user_id)
    if token_data:
        try:
            creds = Credentials.from_authorized_user_info(token_data, YOUTUBE_SCOPES)
            if creds.expired and creds.refresh_token:
                print_step("Refreshing YouTube token...")
                creds.refresh(Request())
                token_data = {
                    "token": creds.token,
                    "refresh_token": creds.refresh_token,
                    "token_uri": creds.token_uri,
                    "client_id": creds.client_id,
                    "client_secret": creds.client_secret,
                    "scopes": creds.scopes,
                    "expiry": creds.expiry.isoformat() if creds.expiry else None
                }
                with open(token_file, "w") as token:
                    json.dump(token_data, token, indent=4)
                save_token_to_db(user_id, token_data)
            if creds.valid:
                print_success("YouTube authentication successful")
                return build("youtube", "v3", credentials=creds)
        except Exception as e:
            print_error(f"Failed to load token from database: {str(e)}")

    # Generate new token
    print_step("Starting YouTube OAuth flow...")
    with open("temp_client_secrets.json", "w") as f:
        json.dump(CLIENT_SECRETS, f)
    
    flow = InstalledAppFlow.from_client_secrets_file("temp_client_secrets.json", YOUTUBE_SCOPES)
    creds = flow.run_local_server(port=0)
    
    token_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
        "expiry": creds.expiry.isoformat() if creds.expiry else None
    }
    with open(token_file, "w") as token:
        json.dump(token_data, token, indent=4)
    save_token_to_db(user_id, token_data)
    
    os.remove("temp_client_secrets.json")
    print_success("YouTube authentication completed")
    return build("youtube", "v3", credentials=creds)

def authenticate_drive(user_id):
    """Authenticate Google Drive API."""
    token_data = get_drive_token_from_db(user_id)
    if not token_data:
        print_warning("No Drive token found")
        return None
    try:
        creds = Credentials.from_authorized_user_info(token_data, DRIVE_SCOPES)
        if creds.expired and creds.refresh_token:
            print_step("Refreshing Drive token...")
            creds.refresh(Request())
            token_data = {
                "token": creds.token,
                "refresh_token": creds.refresh_token,
                "token_uri": creds.token_uri,
                "client_id": creds.client_id,
                "client_secret": creds.client_secret,
                "scopes": creds.scopes,
                "expiry": creds.expiry.isoformat() if creds.expiry else None
            }
            save_drive_token_to_db(user_id, token_data)
        if creds.valid:
            print_success("Drive authentication successful")
            return build("drive", "v3", credentials=creds)
        return None
    except Exception as e:
        print_error(f"Drive authentication failed: {str(e)}")
        return None

# --- File Management Functions ---
def extract_folder_id(drive_link):
    """Extract folder ID from Google Drive link."""
    if not drive_link:
        return None
    match = re.search(r'folders/([a-zA-Z0-9_-]+)', drive_link)
    if match:
        return match.group(1)
    print_error(f"Invalid Google Drive folder link: {drive_link}")
    return None

def download_specific_media(creds, file_id, media_name):
    """Download specific media file from Google Drive by file_id"""
    local_path = os.path.join(TEMP_FOLDER, media_name)
    
    try:
        drive_service = build('drive', 'v3', credentials=creds)
        request = drive_service.files().get_media(fileId=file_id)
        fh = io.FileIO(local_path, 'wb')
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            status, done = downloader.next_chunk()
        print_success(f"Downloaded {media_name}")
        return local_path
    except Exception as e:
        print_error(f"Failed to download {media_name}: {str(e)}")
        return None

def delete_file_from_drive(file_id, creds):
    """Delete a file from Google Drive."""
    try:
        drive_service = build('drive', 'v3', credentials=creds)
        
        # Check permissions first
        try:
            file_info = drive_service.files().get(fileId=file_id, fields='id, name, permissions').execute()
            print_info("Checking permissions for file deletion...")
        except Exception as e:
            print_error(f"Cannot access file for deletion: {str(e)}")
            return False
        
        # Delete the file
        drive_service.files().delete(fileId=file_id).execute()
        print_success("File deleted from Google Drive")
        return True
        
    except Exception as e:
        print_error(f"Could not delete file from Drive: {str(e)}")
        print_info("Note: Make sure the Google account has 'Editor' access to the folder")
        return False

def cleanup_temp_folder():
    """Clean up temporary files."""
    print_step("Cleaning up temporary files...")
    for filename in os.listdir(TEMP_FOLDER):
        file_path = os.path.join(TEMP_FOLDER, filename)
        max_attempts = 5
        for attempt in range(max_attempts):
            try:
                if os.path.isfile(file_path):
                    os.unlink(file_path)
                    print_info(f"Cleaned: {filename}")
                break
            except Exception as e:
                if attempt < max_attempts - 1:
                    sleep(3)
                else:
                    print_warning(f"Could not delete: {filename}")

# --- YouTube Functions ---
def get_channel_info(youtube, expected_channel_id):
    """Verify and retrieve channel info."""
    try:
        request = youtube.channels().list(part="snippet", mine=True)
        response = request.execute()
        channels = response.get("items", [])
        
        if not channels:
            print_error("No channels found for this account")
            return None, None
        
        for channel in channels:
            if channel["id"] == expected_channel_id:
                channel_name = channel["snippet"]["title"]
                channel_id = channel["id"]
                print_success(f"Channel verified: {channel_name}")
                return channel_name, channel_id
        
        print_error(f"Channel ID {expected_channel_id} not found")
        return None, None
    except Exception as e:
        print_error(f"Failed to retrieve channel info: {str(e)}")
        return None, None

def get_caption(media_caption=None):
    """Read caption from media data or caption_yt.txt or use default."""
    if media_caption:
        return media_caption
    
    caption_file = "caption_yt.txt"
    default_caption = "Uploaded via SocioMate"
    if os.path.exists(caption_file):
        with open(caption_file, "r", encoding="utf-8") as f:
            caption = f.read().strip()
            return caption if caption else default_caption
    with open(caption_file, "w", encoding="utf-8") as f:
        f.write(default_caption)
    return default_caption

def upload_video(youtube, file_path, channel_name, title=None, description=None):
    """Upload a video to YouTube."""
    try:
        if not title:
            title = os.path.splitext(os.path.basename(file_path))[0]
        if not description:
            description = get_caption()
            
        tags = ["sociomate", "youtube", "automation"]
        category_id = "22"  # People & Blogs
        privacy_status = "public"

        body = {
            "snippet": {
                "title": title,
                "description": description,
                "tags": tags,
                "categoryId": category_id
            },
            "status": {
                "privacyStatus": privacy_status
            }
        }

        print_step(f"Uploading to YouTube: {os.path.basename(file_path)}")
        media = MediaFileUpload(file_path, chunksize=-1, resumable=True)
        request = youtube.videos().insert(
            part="snippet,status",
            body=body,
            media_body=media
        )

        response = request.execute()
        print_success(f"Uploaded to YouTube: {response['id']}")
        return True
        
    except Exception as e:
        print_error(f"Upload failed: {str(e)}")
        return False

def make_aware(dt):
    """Convert naive datetime to timezone-aware datetime."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return pytz.timezone('Asia/Kolkata').localize(dt)
    return dt

# --- Main Execution Logic ---
async def process_youtube_channel(channel):
    """Process a single YouTube channel."""
    print_header("Processing YouTube Channel")
    print(f"🎬 Channel: {channel['username']}")
    print(f"👤 User: {channel['user_name']}")

    # Authenticate YouTube
    youtube = authenticate_youtube(channel['user_id'])
    if not youtube:
        print_error("YouTube authentication failed")
        return

    # Verify channel
    channel_name, channel_id = get_channel_info(youtube, channel['channel_id'])
    if not channel_name:
        print_error("Channel verification failed")
        return

    # DEBUG: See what's scheduled
    debug_schedule_data_youtube(channel['id'])

    # Get SPECIFIC scheduled media (NEW!)
    scheduled_media = get_scheduled_media_for_youtube(channel['id'])
    if not scheduled_media:
        print_error("No scheduled media found for this channel")
        # Skip this channel
        conn = get_db_connection()
        if conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE youtube SET selected = 'No' WHERE id = %s", (channel['id'],))
            conn.commit()
            cursor.close()
            conn.close()
        return

    print_step(f"Scheduled media: {scheduled_media.get('media_name', 'Unknown')}")

    # Get video from Drive using specific file_id
    drive_creds = authenticate_drive(channel['user_id'])
    video_path = None
    
    if drive_creds and scheduled_media.get('file_id'):
        video_path = download_specific_media(
            drive_creds, 
            scheduled_media['file_id'], 
            scheduled_media['media_name']
        )
    
    # Fallback to local files if specific download fails
    if not video_path:
        video_files = [
            f for f in os.listdir(TEMP_FOLDER)
            if os.path.isfile(os.path.join(TEMP_FOLDER, f))
            and os.path.splitext(f)[1].lower() in VIDEO_EXTENSIONS
        ]
        if video_files:
            video_path = os.path.join(TEMP_FOLDER, video_files[0])
            print_warning(f"Using fallback local file: {video_files[0]}")
        else:
            print_error("No video files available")
            return

    # Upload to YouTube
    print_header("Uploading to YouTube")
    
    # Use media-specific title and caption if available
    media_title = scheduled_media.get('title') or os.path.splitext(scheduled_media['media_name'])[0]
    media_caption = scheduled_media.get('caption')
    
    if upload_video(youtube, video_path, channel_name, title=media_title, description=media_caption):
        # Cleanup
        print_header("Cleanup")
        if scheduled_media.get('file_id') and drive_creds:
            print_step("Removing file from Google Drive...")
            if delete_file_from_drive(scheduled_media['file_id'], drive_creds):
                print_success("File removed from Drive")
            else:
                print_warning("File uploaded but could not delete from Drive")
        
        # Delete local file
        try:
            os.remove(video_path)
            print_success("Local file cleaned")
        except Exception as e:
            print_warning(f"Could not delete local file: {str(e)}")
        
        # Update database with specific media info (NEW!)
        update_channel_after_post(channel['id'], scheduled_media['file_id'])
    else:
        print_error("Upload failed - keeping files")

    cleanup_temp_folder()

async def main():
    print_header("YouTube Auto-Uploader")
    print_info("Starting automation service...")

    if not os.path.exists(TEMP_FOLDER):
        os.makedirs(TEMP_FOLDER)
        print_success(f"Created temp folder: {TEMP_FOLDER}")

    while True:
        channel = get_next_scheduled_youtube()

        if not channel:
            print_info(f"No channels scheduled. Checking again in {IDLE_SLEEP_MINUTES} minutes...")
            await asyncio.sleep(IDLE_SLEEP_MINUTES * 60)
            subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])
            continue

        print_header("Next Scheduled Post")
        print(f"🎬 Channel: {channel['username']}")
        print(f"👤 User: {channel['user_name']}")
        print(f"⏰ Time: {channel['next_post_time'].strftime('%Y-%m-%d %H:%M:%S %Z')}")

        # Countdown logic
        while True:
            IST_OFFSET = timedelta(hours=5, minutes=30)
            incorrect_local_time = channel['next_post_time']
            corrected_utc_time = incorrect_local_time - IST_OFFSET
            next_post_time_aware = pytz.utc.localize(corrected_utc_time)
            now_aware = datetime.now(pytz.utc)
            wait_seconds = (next_post_time_aware - now_aware).total_seconds()

            if wait_seconds <= 0:
                print_success("Time to upload!")
                break

            if wait_seconds > RESCHEDULE_THRESHOLD_MINUTES * 60:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print_warning(f"Upload in {minutes}m {seconds}s - Running scheduler...")
                await asyncio.sleep(over_time * 60)
                try:
                    subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])
                    print_success("Scheduler updated")
                except subprocess.CalledProcessError as e:
                    print_error(f"Scheduler failed: {str(e)}")
                print_info("Restarting YouTube uploader...")
                os.execv(sys.executable, [sys.executable] + sys.argv)
            elif wait_seconds > ACTIVE_COUNTDOWN_SECONDS:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print_countdown(f"Next upload in {minutes}m {seconds}s - Monitoring...")
                await asyncio.sleep(1)
            else:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print_countdown(f"Uploading in {minutes}m {seconds}s...")
                await asyncio.sleep(1)

        # Upload process
        print_header("Starting Upload")
        await process_youtube_channel(channel)
        
        print_header("Completed")
        print_success("Ready for next upload")
        await asyncio.sleep(2)
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())