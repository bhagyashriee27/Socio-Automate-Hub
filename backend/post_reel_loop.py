import os
import re
import json
import sys
from time import sleep
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
import io
from datetime import datetime, timedelta
import pytz
from instagrapi import Client
import ffmpeg
import subprocess
import mysql.connector
from google.auth.transport.requests import Request
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# --- Configuration ---
TEMP_FOLDER = "temp_downloads"
CAPTION_FILE = "long_vid_caption.txt"
SCOPES = ["https://www.googleapis.com/auth/drive"]

# Database configuration from environment variables
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "database": os.getenv("DB_DATABASE"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT"))
}
ACTIVE_COUNTDOWN_SECONDS = 300  # 5 minutes
IDLE_SLEEP_MINUTES = 0.3  # How long to wait if no accounts are scheduled
RESCHEDULE_THRESHOLD_MINUTES = 15  # If wait time exceeds this, run scheduler and restart

over_time = 1

# In-memory cache for credentials to avoid redundant database queries
_credentials_cache = {}

# --- Database Functions ---
def get_db_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print(f"ERROR: Database connection failed: {str(e)}")
        return None

def get_next_scheduled_account():
    conn = get_db_connection()
    if not conn:
        return None
    cursor = conn.cursor(dictionary=True)
    query = """
        SELECT 
            i.id, i.username, i.passwand, i.token_sesson, i.token_drive, 
            i.google_drive_link, i.next_post_time, u.Name AS user_name 
        FROM instagram i
        JOIN user u ON i.user_id = u.Id
        WHERE i.selected = 'Yes' AND i.done = 'No' AND i.posts_left > 0 AND i.next_post_time IS NOT NULL
        ORDER BY i.next_post_time ASC
        LIMIT 1
    """
    cursor.execute(query)
    account = cursor.fetchone()
    cursor.close()
    conn.close()
    return account

def debug_schedule_data(account_id):
    """Debug function to see all scheduled media"""
    conn = get_db_connection()
    if not conn:
        return
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT custom_schedule_data, next_post_time FROM instagram WHERE id = %s", (account_id,))
    result = cursor.fetchone()
    cursor.close()
    conn.close()
    
    if result and result['custom_schedule_data']:
        try:
            schedule_data = json.loads(result['custom_schedule_data'])
            print("\n--- DEBUG: All Scheduled Media ---")
            for i, media in enumerate(schedule_data):
                print(f"  {i+1}. {media.get('media_name')} | Type: {media.get('schedule_type')} | Status: {media.get('status')} | Time: {media.get('scheduled_datetime')}")
            print(f"  Next Post Time: {result['next_post_time']}")
            print("--- END DEBUG ---\n")
        except json.JSONDecodeError:
            print("  DEBUG: Invalid schedule data")

def get_scheduled_media_for_account(account_id):
    """Get the next scheduled media file for this account that should be posted now"""
    conn = get_db_connection()
    if not conn:
        return None
    cursor = conn.cursor(dictionary=True)
    
    # Get custom_schedule_data AND next_post_time to understand what type of post is scheduled
    cursor.execute("SELECT custom_schedule_data, next_post_time FROM instagram WHERE id = %s", (account_id,))
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

def update_account_after_post(account_id, media_file_id):
    """Update database after successful post - update specific media status and counters"""
    conn = get_db_connection()
    if not conn:
        return False
    
    try:
        cursor = conn.cursor(dictionary=True)
        
        # Get current data
        cursor.execute("SELECT custom_schedule_data, posts_left, post_daily_range_left FROM instagram WHERE id = %s", (account_id,))
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
            UPDATE instagram 
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
            account_id
        ))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"DB Updated for Account ID {account_id}:")
        print(f"  - Media {media_file_id} status updated to 'completed'")
        print(f"  - posts_left: {result['posts_left']} → {new_posts_left}")
        print(f"  - post_daily_range_left: {result['post_daily_range_left']} → {new_daily_range_left}")
        print(f"  - done: '{done_status}'")
        
        return True
        
    except Exception as e:
        print(f"ERROR updating database for account {account_id}: {str(e)}")
        conn.rollback()
        cursor.close()
        conn.close()
        return False

# --- Helper Functions ---
def get_instagram_session(account):
    cl = Client()
    if account['token_sesson'] and account['token_sesson'] != '{}':
        try:
            cl.set_settings(json.loads(account['token_sesson']))
            sleep(2)
            print(f"Loaded Instagram session for {account['username']}.")
            return cl
        except Exception as e:
            print(f"Invalid session for {account['username']}, attempting login: {str(e)}")
    try:
        cl.login(account['username'], account['passwand'])
        session = cl.get_settings()
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE instagram SET token_sesson = %s WHERE id = %s", (json.dumps(session), account['id']))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Logged in and saved new session for {account['username']}.")
        return cl
    except Exception as e:
        print(f"ERROR: Login failed for {account['username']}: {str(e)}")
        return None

def save_drive_token(creds, account_id):
    """Save Google Drive token to database."""
    try:
        conn = get_db_connection()
        if not conn:
            print(f"ERROR: Failed to save token for account ID {account_id}: No database connection")
            return False
        cursor = conn.cursor()
        cursor.execute("UPDATE instagram SET token_drive = %s WHERE id = %s", (creds.to_json(), account_id))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Saved Google Drive token to database for account ID {account_id}")
        return True
    except Exception as e:
        print(f"ERROR: Failed to save token for account ID {account_id}: {str(e)}")
        return False

def get_drive_credentials(account, max_retries=3):
    """Retrieve or refresh Google Drive credentials with retry logic, storing only in database."""
    global _credentials_cache
    account_id = account['id']
    username = account['username']

    # Check in-memory cache first
    if account_id in _credentials_cache and _credentials_cache[account_id].valid:
        print(f"Using cached credentials for {username}")
        return _credentials_cache[account_id]

    # Load from database
    creds = None
    if account['token_drive']:
        try:
            token_str = account['token_drive'].strip('"').replace('\\"', '"').replace("\\'", "'")
            token_data = json.loads(token_str)
            creds = Credentials.from_authorized_user_info(token_data, SCOPES)
            print(f"Loaded Google Drive credentials from database for {username}")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f"ERROR: Invalid token_drive JSON for {username}: {str(e)}")
            creds = None

    # Refresh token if expired
    if creds and creds.expired and creds.refresh_token:
        for attempt in range(max_retries):
            try:
                creds.refresh(Request())
                print(f"Refreshed Google Drive token for {username}")
                if save_drive_token(creds, account_id):
                    _credentials_cache[account_id] = creds
                return creds
            except Exception as e:
                print(f"ERROR: Refresh attempt {attempt + 1}/{max_retries} failed for {username}: {str(e)}")
                if attempt < max_retries - 1:
                    sleep(5)  # Wait before retrying
                else:
                    print(f"ERROR: Max refresh retries reached for {username}. Attempting re-authentication.")
                    creds = None

    # Re-authenticate if no valid credentials
    if not creds or not creds.valid:
        if not os.path.exists('credentials.json'):
            print(f"ERROR: credentials.json not found for {username}. Skipping account.")
            return None
        try:
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
            if save_drive_token(creds, account_id):
                _credentials_cache[account_id] = creds
                print(f"Obtained new Google Drive token for {username}")
            else:
                print(f"ERROR: Failed to save new token for {username}. Skipping account.")
                return None
        except Exception as e:
            print(f"ERROR: Failed to obtain new Google Drive token for {username}: {str(e)}")
            return None

    return creds

def extract_folder_id(drive_link):
    if not drive_link:
        return None
    match = re.search(r'folders/([a-zA-Z0-9_-]+)', drive_link)
    if match:
        return match.group(1)
    print(f"ERROR: Invalid Google Drive folder link: {drive_link}")
    return None

def create_instagram_feed_folder(creds, username):
    drive_service = build('drive', 'v3', credentials=creds)
    folder_name = f"instagram_{username}"
    query = f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents"
    results = drive_service.files().list(q=query, fields="files(id, name)").execute()
    folders = results.get('files', [])

    if not folders:
        file_metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder'
        }
        folder = drive_service.files().create(body=file_metadata, fields='id').execute()
        folder_id = folder.get('id')
        print(f"Created 'instagram_{username}' folder with ID: {folder_id}")
    else:
        folder_id = folders[0]['id']
        print(f"Found existing 'instagram_{username}' folder with ID: {folder_id}")

    try:
        permission = {'type': 'anyone', 'role': 'reader'}
        drive_service.permissions().create(fileId=folder_id, body=permission).execute()
        folder = drive_service.files().get(fileId=folder_id, fields='webViewLink').execute()
        folder_link = folder.get('webViewLink')
        print(f"Shareable link for 'instagram_{username}' folder: {folder_link}")
    except Exception as e:
        print(f"ERROR: Failed to create shareable link: {str(e)}")
        folder_link = f"https://drive.google.com/drive/folders/{folder_id}"

    return folder_id, folder_link

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
        print(f"Downloaded {media_name} to {local_path}")
        return local_path
    except Exception as e:
        print(f"ERROR: Failed to download {media_name}: {str(e)}")
        return None

def delete_file_from_drive(file_id, creds):
    """Delete a file from Google Drive."""
    try:
        drive_service = build('drive', 'v3', credentials=creds)
        drive_service.files().delete(fileId=file_id).execute()
        print(f"SUCCESS: Deleted file {file_id} from Google Drive")
        return True
    except Exception as e:
        print(f"ERROR: Failed to delete file {file_id} from Google Drive: {str(e)}")
        return False

def adjust_aspect_ratio(video_path, output_path):
    try:
        probe = ffmpeg.probe(video_path)
        video_stream = next((s for s in probe['streams'] if s['codec_type'] == 'video'), None)
        width, height = int(video_stream['width']), int(video_stream['height'])
        if abs((width / height) - (9 / 16)) < 0.01:
            return False
        (ffmpeg.input(video_path).filter('scale', '1080:1920:force_original_aspect_ratio=decrease')
         .filter('pad', '1080', '1920', '(ow-iw)/2', '(oh-ih)/2', 'black')
         .output(output_path, vcodec='libx264', acodec='aac').run(overwrite_output=True, quiet=True))
        return True
    except Exception as e:
        print(f"ERROR: Failed to adjust aspect ratio for {video_path}: {str(e)}")
        return False

def post_media(client, media_path, caption, is_video=True):
    try:
        media_name = os.path.basename(media_path)
        full_caption = f"{caption}"
        thumbnail_path = None
        if is_video:
            thumbnail_path = os.path.splitext(media_path)[0] + "_thumb.jpg"
            try:
                ffmpeg.input(media_path, ss=1).output(thumbnail_path, vframes=1).run(overwrite_output=True, quiet=True)
            except ffmpeg.Error:
                thumbnail_path = None
        if is_video:
            client.clip_upload(media_path, caption=full_caption, thumbnail=thumbnail_path)
        else:
            client.photo_upload(media_path, caption=full_caption)
        print(f"SUCCESS: Posted {media_name} to {client.username}'s account.")
        return True
    except Exception as e:
        print(f"ERROR: Failed to post {media_name}: {str(e)}")
        return False

def cleanup_temp_folder():
    print("Cleaning up temporary files...")
    for filename in os.listdir(TEMP_FOLDER):
        file_path = os.path.join(TEMP_FOLDER, filename)
        max_attempts = 5
        for attempt in range(max_attempts):
            try:
                if os.path.isfile(file_path):
                    os.unlink(file_path)
                    print(f"Deleted {file_path}")
                break
            except Exception as e:
                if attempt < max_attempts - 1:
                    print(f"Failed to delete {file_path} (attempt {attempt + 1}/{max_attempts}): {str(e)}. Retrying in 3 seconds...")
                    sleep(3)
                else:
                    print(f"ERROR: Failed to delete {file_path} after {max_attempts} attempts: {str(e)}")

def make_aware(dt):
    """Convert naive datetime to timezone-aware datetime."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return pytz.timezone('Asia/Kolkata').localize(dt)
    return dt

# --- Main Execution Logic ---
def main():
    print("--- Continuous Instagram Worker ---")
    
    if not os.path.exists(TEMP_FOLDER):
        os.makedirs(TEMP_FOLDER)
    if not os.path.exists(CAPTION_FILE):
        with open(CAPTION_FILE, "w", encoding="utf-8") as f:
            f.write("#default #caption #instagood")
    
    while True:
        account = get_next_scheduled_account()
        
        if not account:
            print(f"No accounts currently scheduled. Waiting for {IDLE_SLEEP_MINUTES} minutes...")
            sleep(IDLE_SLEEP_MINUTES * 60)
            continue

        print("\n----------------------------------------------------")
        print(f"Found next scheduled post:")
        print(f"  >> User:    {account.get('user_name', 'N/A')}")
        print(f"  >> Account: {account.get('username', 'N/A')}")
        print("----------------------------------------------------")

        # Countdown logic
        while True:
            IST_OFFSET = timedelta(hours=5, minutes=30)
            incorrect_local_time = account['next_post_time']
            corrected_utc_time = incorrect_local_time - IST_OFFSET
            next_post_time_aware = pytz.utc.localize(corrected_utc_time)
            now_aware = datetime.now(pytz.utc)
            wait_seconds = (next_post_time_aware - now_aware).total_seconds()

            if wait_seconds <= 0:
                print("Time to post!")
                break

            if wait_seconds > RESCHEDULE_THRESHOLD_MINUTES * 60:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print(f"Next post in {minutes}m {seconds}s is over {RESCHEDULE_THRESHOLD_MINUTES} minutes. Running scheduler_intagram.py in {over_time * 60} seconds and restarting...")
                sleep(over_time * 60)
                try:
                    subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])
                    print("Ran scheduler_intagram.py successfully.")
                except subprocess.CalledProcessError as e:
                    print(f"ERROR: Failed to run scheduler_intagram.py: {str(e)}")
                print("Restarting post_reel_loop.py...")
                # Restart the script
                os.execv(sys.executable, [sys.executable] + sys.argv)
            elif wait_seconds > ACTIVE_COUNTDOWN_SECONDS:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print(f"Next post in {minutes}m {seconds}s. Waiting... (Checking every 30s)", end='\r')
                sleep(15)
            else:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print(f"Active countdown: Post in {minutes}m {seconds}s...", end='\r')
                sleep(1)

        # Posting logic
        print(f"Initiating post for {account['username']}...")

        # DEBUG: See what's scheduled
        debug_schedule_data(account['id'])

        client = get_instagram_session(account)
        if not client:
            print("ERROR: Login failed. Skipping this account and looking for the next one.")
            sleep(10)
            continue

        creds = get_drive_credentials(account)
        if not creds:
            print("ERROR: Google Drive credentials not valid or could not be obtained. Skipping this account.")
            # Skip this account by marking it as done temporarily
            conn = get_db_connection()
            if conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE instagram SET selected = 'No' WHERE id = %s", (account['id'],))
                conn.commit()
                cursor.close()
                conn.close()
            sleep(10)
            continue

        # Get the SPECIFIC scheduled media to post (not oldest)
        scheduled_media = get_scheduled_media_for_account(account['id'])
        if not scheduled_media:
            print(f"ERROR: No scheduled media found for {account['username']}. Skipping.")
            # Skip this account
            conn = get_db_connection()
            if conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE instagram SET selected = 'No' WHERE id = %s", (account['id'],))
                conn.commit()
                cursor.close()
                conn.close()
            cleanup_temp_folder()
            continue

        print(f"Selected scheduled media to post: {scheduled_media.get('media_name', 'Unknown')}")

        # Download the specific scheduled media
        media_to_post = download_specific_media(
            creds, 
            scheduled_media['file_id'], 
            scheduled_media['media_name']
        )
        
        if not media_to_post:
            print(f"ERROR: Failed to download scheduled media for {account['username']}. Skipping.")
            cleanup_temp_folder()
            continue

        # Determine if it's video or image
        is_video = scheduled_media['media_name'].lower().endswith(('.mp4', '.mov', '.avi', '.mkv'))

        post_path = media_to_post
        if is_video:
            adjusted_path = os.path.join(TEMP_FOLDER, f"adjusted_{os.path.basename(media_to_post)}")
            if adjust_aspect_ratio(media_to_post, adjusted_path):
                post_path = adjusted_path

        try:
            caption = scheduled_media.get('caption', '')
            if not caption:
                with open(CAPTION_FILE, "r", encoding="utf-8") as f:
                    caption = f.read()
        except FileNotFoundError:
            caption = "#reels #instagram"

        if post_media(client, post_path, caption, is_video=is_video):
            # Delete from Google Drive after successful posting
            if scheduled_media.get('file_id'):
                if delete_file_from_drive(scheduled_media['file_id'], creds):
                    print(f"SUCCESS: File deleted from Google Drive after posting")
                else:
                    print(f"WARNING: File posted but could not delete from Google Drive")
            
            # Update database - specific media status and counters
            update_account_after_post(account['id'], scheduled_media['file_id'])
        else:
            print("ERROR: Post failed. Database will not be updated for this run. Looking for next task.")

        cleanup_temp_folder()
        print("Task complete. Looking for the next scheduled post...")
        sleep(2)
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])

if __name__ == "__main__":
    main()