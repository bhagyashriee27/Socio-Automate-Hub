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

def update_account_after_post(account_id):
    conn = get_db_connection()
    if not conn:
        return
    cursor = conn.cursor()
    cursor.execute("UPDATE instagram SET posts_left = posts_left - 1 WHERE id = %s", (account_id,))
    cursor.execute("SELECT posts_left FROM instagram WHERE id = %s", (account_id,))
    posts_left = cursor.fetchone()[0]
    done_status = 'Yes' if posts_left <= 0 else 'No'
    update_query = "UPDATE instagram SET selected = 'No', done = %s, next_post_time = NULL WHERE id = %s"
    cursor.execute(update_query, (done_status, account_id))
    conn.commit()
    cursor.close()
    conn.close()
    print(f"DB Updated for Account ID {account_id}: posts_left is now {posts_left}, done is '{done_status}'.")

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

def download_from_drive(file_id, local_path, creds):
    drive_service = build('drive', 'v3', credentials=creds)
    request = drive_service.files().get_media(fileId=file_id)
    fh = io.FileIO(local_path, 'wb')
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        status, done = downloader.next_chunk()
    print(f"Downloaded {file_id} to {local_path}")

def get_oldest_media_file(creds, account):
    """Get the oldest media file from Google Drive based on creation time."""
    drive_service = build('drive', 'v3', credentials=creds)
    conn = get_db_connection()
    if not conn:
        return None, None, None
    cursor = conn.cursor()
    cursor.execute("SELECT google_drive_link FROM instagram WHERE id = %s", (account['id'],))
    drive_link = cursor.fetchone()[0]
    cursor.close()
    conn.close()

    folder_id = extract_folder_id(drive_link)
    username = account['username']
    
    if drive_link and folder_id:
        try:
            drive_service.files().get(fileId=folder_id, fields='id').execute()
            print(f"Using existing Google Drive folder link: {drive_link} for account {username}")
        except Exception as e:
            print(f"ERROR: Invalid or inaccessible folder ID {folder_id} for account {username}: {str(e)}. Creating new folder.")
            folder_id, folder_link = create_instagram_feed_folder(creds, username)
            conn = get_db_connection()
            if not conn:
                return None, None, None
            cursor = conn.cursor()
            cursor.execute("UPDATE instagram SET google_drive_link = %s WHERE id = %s", (folder_link, account['id']))
            conn.commit()
            cursor.close()
            conn.close()
            print(f"Updated Google Drive link for account {username}: {folder_link}")
    else:
        folder_id, folder_link = create_instagram_feed_folder(creds, username)
        conn = get_db_connection()
        if not conn:
            return None, None, None
        cursor = conn.cursor()
        cursor.execute("UPDATE instagram SET google_drive_link = %s WHERE id = %s", (folder_link, account['id']))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Updated Google Drive link for account {username}: {folder_link}")

    query = f"'{folder_id}' in parents"
    results = drive_service.files().list(
        q=query, 
        fields="files(id, name, mimeType, createdTime)",
        orderBy="createdTime"  # Get files ordered by creation time (oldest first)
    ).execute()
    files = results.get('files', [])

    if not files:
        print(f"ERROR: No media files found in folder {folder_id}")
        return None, None, None

    # Filter for media files and get the oldest one
    oldest_file = None
    for file in files:
        if file['mimeType'].startswith('image/') or file['mimeType'].startswith('video/'):
            oldest_file = file
            break  # Since files are sorted by creation time, first media file is oldest

    if not oldest_file:
        print(f"ERROR: No valid media files found in folder {folder_id}")
        return None, None, None

    local_path = os.path.join(TEMP_FOLDER, oldest_file['name'])
    print(f"Downloading oldest file: {oldest_file['name']} (created: {oldest_file['createdTime']})")
    download_from_drive(oldest_file['id'], local_path, creds)
    
    is_video = oldest_file['mimeType'].startswith('video/')
    return local_path, oldest_file['id'], is_video  # Return local path, file ID, and media type

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
        full_caption = f"{os.path.splitext(media_name)[0]}\n\n{caption}"
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
        client = get_instagram_session(account)
        if not client:
            print("ERROR: Login failed. Skipping this account and looking for the next one.")
            sleep(10)
            continue

        creds = get_drive_credentials(account)
        if not creds:
            print("ERROR: Google Drive credentials not valid or could not be obtained. Skipping this account.")
            update_account_after_post(account['id'])  # Skip to avoid stalling
            sleep(10)
            continue

        # Get the oldest media file
        media_to_post, drive_file_id, is_video = get_oldest_media_file(creds, account)
        if not media_to_post:
            print(f"ERROR: No media files found in Google Drive for {account['username']}. Skipping.")
            update_account_after_post(account['id'])
            cleanup_temp_folder()
            continue

        print(f"Selected oldest media to post: {os.path.basename(media_to_post)}")

        post_path = media_to_post
        if is_video:
            adjusted_path = os.path.join(TEMP_FOLDER, f"adjusted_{os.path.basename(media_to_post)}")
            if adjust_aspect_ratio(media_to_post, adjusted_path):
                post_path = adjusted_path

        try:
            with open(CAPTION_FILE, "r", encoding="utf-8") as f:
                caption = f.read()
        except FileNotFoundError:
            caption = "#reels #instagram"

        if post_media(client, post_path, caption, is_video=is_video):
            # Delete from Google Drive after successful posting
            if drive_file_id:
                if delete_file_from_drive(drive_file_id, creds):
                    print(f"SUCCESS: File deleted from Google Drive after posting")
                else:
                    print(f"WARNING: File posted but could not delete from Google Drive")
            
            update_account_after_post(account['id'])
        else:
            print("ERROR: Post failed. Database will not be updated for this run. Looking for next task.")

        cleanup_temp_folder()
        print("Task complete. Looking for the next scheduled post...")
        sleep(2)
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])

if __name__ == "__main__":
    main()