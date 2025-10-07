import os
import sys
import json
import re
from time import sleep
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
import io
from datetime import datetime, timedelta
import pytz
import mysql.connector
from google.auth.transport.requests import Request
from telegram import Bot
from telegram.error import TelegramError
import asyncio
import subprocess
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# --- Configuration ---
TEMP_FOLDER = "temp_telegram"
BOT_TOKEN = '7763155216:AAGcbS81suUb5lMCVqg--fhhJJf8YNens8w'
SCOPES = ['https://www.googleapis.com/auth/drive']

# Database configuration from environment variables
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "database": os.getenv("DB_DATABASE"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT"))
}
ACTIVE_COUNTDOWN_SECONDS = 1*60  # 5 minutes
IDLE_SLEEP_MINUTES = 0.3  # How long to wait if no channels are scheduled
RESCHEDULE_THRESHOLD_MINUTES = 15  # If wait time exceeds this, run scheduler and restart
over_time = 1  # Wait time in minutes before running scheduler_telegram.py and restarting

# In-memory cache for credentials to avoid redundant database queries
_credentials_cache = {}

# --- Database Functions ---
def get_db_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print(f"ERROR: Database connection failed: {str(e)}")
        return None

def get_next_scheduled_channel():
    conn = get_db_connection()
    if not conn:
        return None
    cursor = conn.cursor(dictionary=True)
    query = """
        SELECT 
            t.id, t.channel_name, t.token_sesson, t.token_drive, 
            t.google_drive_link, t.next_post_time, t.posts_left
        FROM telegram t
        WHERE t.selected = 'Yes' AND t.done = 'No' AND t.posts_left > 0 AND t.next_post_time IS NOT NULL
        ORDER BY t.next_post_time ASC
        LIMIT 1
    """
    cursor.execute(query)
    channel = cursor.fetchone()
    cursor.close()
    conn.close()
    return channel

def update_channel_after_post(channel_id):
    conn = get_db_connection()
    if not conn:
        return
    cursor = conn.cursor()
    cursor.execute("UPDATE telegram SET posts_left = posts_left - 1 WHERE id = %s", (channel_id,))
    cursor.execute("SELECT posts_left FROM telegram WHERE id = %s", (channel_id,))
    posts_left = cursor.fetchone()[0]
    done_status = 'Yes' if posts_left <= 0 else 'No'
    update_query = "UPDATE telegram SET selected = 'No', done = %s, next_post_time = NULL WHERE id = %s"
    cursor.execute(update_query, (done_status, channel_id))
    conn.commit()
    cursor.close()
    conn.close()
    print(f"DB Updated for Channel ID {channel_id}: posts_left is now {posts_left}, done is '{done_status}'.")

# --- Helper Functions ---
def get_channel_details(channel):
    conn = get_db_connection()
    if not conn:
        print("ERROR: Database connection failed. Cannot update channel details.")
        return None, None

    row_id = channel['id']
    channel_name = channel['channel_name']
    channel_id = channel['token_sesson']

    if not channel_name or not channel_id:
        print(f"Channel details incomplete for row ID {row_id}. Prompting for input.")
        channel_name = input(f"Enter Telegram channel name for row ID {row_id} (e.g., MyChannel): ").strip()
        channel_id = input(f"Enter Telegram channel ID for row ID {row_id} (e.g., @MyChannel or -100123456789): ").strip()

        if not channel_id.startswith('@') and not channel_id.startswith('-'):
            channel_id = f"@{channel_id}"

        cursor = conn.cursor()
        update_query = "UPDATE telegram SET channel_name = %s, token_sesson = %s WHERE id = %s"
        cursor.execute(update_query, (channel_name, channel_id, row_id))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Updated Telegram channel details for row ID {row_id}: {channel_name}, {channel_id}")

    return channel_name, channel_id

def save_drive_token(creds, channel_id):
    try:
        conn = get_db_connection()
        if not conn:
            print(f"ERROR: Failed to save token for channel ID {channel_id}: No database connection")
            return False
        cursor = conn.cursor()
        cursor.execute("UPDATE telegram SET token_drive = %s WHERE id = %s", (creds.to_json(), channel_id))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Saved Google Drive token to database for channel ID {channel_id}")
        return True
    except Exception as e:
        print(f"ERROR: Failed to save token for channel ID {channel_id}: {str(e)}")
        return False

def get_drive_credentials(channel, max_retries=3):
    global _credentials_cache
    channel_id = channel['id']
    channel_name = channel['channel_name']

    if channel_id in _credentials_cache and _credentials_cache[channel_id].valid:
        print(f"Using cached credentials for {channel_name}")
        return _credentials_cache[channel_id]

    creds = None
    if channel['token_drive']:
        try:
            token_str = channel['token_drive'].strip('"').replace('\\"', '"').replace("\\'", "'")
            token_data = json.loads(token_str)
            creds = Credentials.from_authorized_user_info(token_data, SCOPES)
            print(f"Loaded Google Drive credentials from database for {channel_name}")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f"ERROR: Invalid token_drive JSON for {channel_name}: {str(e)}")
            creds = None

    if creds and creds.expired and creds.refresh_token:
        for attempt in range(max_retries):
            try:
                creds.refresh(Request())
                print(f"Refreshed Google Drive token for {channel_name}")
                if save_drive_token(creds, channel_id):
                    _credentials_cache[channel_id] = creds
                return creds
            except Exception as e:
                print(f"ERROR: Refresh attempt {attempt + 1}/{max_retries} failed for {channel_name}: {str(e)}")
                if attempt < max_retries - 1:
                    sleep(5)
                else:
                    print(f"ERROR: Max refresh retries reached for {channel_name}. Attempting re-authentication.")
                    creds = None

    if not creds or not creds.valid:
        if not os.path.exists('credentials.json'):
            print(f"ERROR: credentials.json not found for {channel_name}. Skipping channel.")
            return None
        try:
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
            if save_drive_token(creds, channel_id):
                _credentials_cache[channel_id] = creds
                print(f"Obtained new Google Drive token for {channel_name}")
            else:
                print(f"ERROR: Failed to save new token for {channel_name}. Skipping channel.")
                return None
        except Exception as e:
            print(f"ERROR: Failed to obtain new Google Drive token for {channel_name}: {str(e)}")
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

def create_telegram_feed_folder(creds, channel_name):
    drive_service = build('drive', 'v3', credentials=creds)
    folder_name = f"telegram_{channel_name}"
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
        print(f"Created 'telegram_{channel_name}' folder with ID: {folder_id}")
    else:
        folder_id = folders[0]['id']
        print(f"Found existing 'telegram_{channel_name}' folder with ID: {folder_id}")

    try:
        permission = {'type': 'anyone', 'role': 'reader'}
        drive_service.permissions().create(fileId=folder_id, body=permission).execute()
        folder = drive_service.files().get(fileId=folder_id, fields='webViewLink').execute()
        folder_link = folder.get('webViewLink')
        print(f"Shareable link for 'telegram_{channel_name}' folder: {folder_link}")
    except Exception as e:
        print(f"ERROR: Failed to create shareable link: {str(e)}")
        folder_link = f"https://drive.google.com/drive/folders/{folder_id}"

    return folder_id, folder_link

def get_drive_folder_id(creds, channel):
    conn = get_db_connection()
    drive_link = channel['google_drive_link']
    row_id = channel['id']
    channel_name = channel['channel_name']

    if drive_link:
        folder_id = extract_folder_id(drive_link)
        if folder_id:
            try:
                drive_service = build('drive', 'v3', credentials=creds)
                drive_service.files().get(fileId=folder_id, fields='id').execute()
                print(f"Using existing Google Drive folder link: {drive_link} for channel {channel_name}")
                if conn:
                    conn.close()
                return folder_id, drive_link
            except Exception as e:
                print(f"ERROR: Invalid or inaccessible folder ID {folder_id} for channel {channel_name}: {str(e)}. Creating new folder.")

    folder_id, folder_link = create_telegram_feed_folder(creds, channel_name)
    if conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE telegram SET google_drive_link = %s WHERE id = %s", (folder_link, row_id))
        conn.commit()
        print(f"Updated Google Drive link for channel {channel_name}: {folder_link}")
        cursor.close()
        conn.close()
    else:
        print("ERROR: Database connection failed. Using new folder without updating database.")

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

def get_oldest_media_file(creds, channel):
    """Get the oldest media file from Google Drive based on creation time."""
    folder_id, folder_link = get_drive_folder_id(creds, channel)
    if not folder_id:
        print("ERROR: Failed to get folder ID. Exiting.")
        return None, None

    drive_service = build('drive', 'v3', credentials=creds)
    query = f"'{folder_id}' in parents"
    results = drive_service.files().list(
        q=query, 
        fields="files(id, name, mimeType, createdTime)",
        orderBy="createdTime"  # Get files ordered by creation time (oldest first)
    ).execute()
    files = results.get('files', [])

    if not files:
        print(f"ERROR: No media files found in folder {folder_id}")
        return None, None

    # Filter for media files and get the oldest one
    media_files = []
    for file in files:
        if file['mimeType'].startswith(('image/', 'video/')) or file['name'].lower().endswith('.zip'):
            media_files.append(file)

    if not media_files:
        print(f"ERROR: No valid media files found in folder {folder_id}")
        return None, None

    # Get the oldest file (first in the sorted list)
    oldest_file = media_files[0]
    local_path = os.path.join(TEMP_FOLDER, oldest_file['name'])
    
    print(f"Downloading oldest file: {oldest_file['name']} (created: {oldest_file['createdTime']})")
    download_from_drive(oldest_file['id'], local_path, creds)
    
    return local_path, oldest_file['id']  # Return both local path and file ID for deletion

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

async def send_file_to_channel(file_path, channel_id):
    try:
        bot = Bot(token=BOT_TOKEN)
        file_title = os.path.splitext(os.path.basename(file_path))[0]
        with open(file_path, 'rb') as file:
            if file_path.lower().endswith(('.mp4', '.avi', '.mov', '.mkv')):
                await bot.send_video(
                    chat_id=channel_id,
                    video=file,
                    supports_streaming=True,
                    caption=file_title
                )
            elif file_path.lower().endswith(('.jpg', '.jpeg', '.png', '.gif')):
                await bot.send_photo(
                    chat_id=channel_id,
                    photo=file,
                    caption=file_title
                )
            elif file_path.lower().endswith('.zip'):
                await bot.send_document(
                    chat_id=channel_id,
                    document=file,
                    caption=file_title
                )
        print(f"Successfully posted file: {file_path}")
        return True
    except TelegramError as e:
        print(f"ERROR: Telegram error: {str(e)}")
        return False
    except Exception as e:
        print(f"ERROR: Error sending file: {str(e)}")
        return False

async def process_channel(channel):
    print(f"\n----------------------------------------------------")
    print(f"Processing Telegram channel: {channel['channel_name']}")
    print("----------------------------------------------------")

    channel_name, channel_id = get_channel_details(channel)
    if not channel_name or not channel_id:
        print(f"ERROR: Failed to get valid channel details for row ID {channel['id']}. Skipping.")
        update_channel_after_post(channel['id'])
        cleanup_temp_folder()
        return

    creds = get_drive_credentials(channel)
    if not creds:
        print(f"ERROR: Failed to get Google Drive credentials for {channel_name}. Skipping.")
        update_channel_after_post(channel['id'])
        cleanup_temp_folder()
        return

    # Get the oldest media file and its Drive ID
    media_to_post, drive_file_id = get_oldest_media_file(creds, channel)
    if not media_to_post:
        print(f"ERROR: No media files downloaded from Google Drive for {channel_name}. Skipping.")
        update_channel_after_post(channel['id'])
        cleanup_temp_folder()
        return

    print(f"Selected oldest media to post: {os.path.basename(media_to_post)}")

    if await send_file_to_channel(media_to_post, channel_id):
        # Delete from Google Drive after successful posting
        if drive_file_id:
            if delete_file_from_drive(drive_file_id, creds):
                print(f"SUCCESS: File deleted from Google Drive after posting")
            else:
                print(f"WARNING: File posted but could not delete from Google Drive")
        
        update_channel_after_post(channel['id'])
    else:
        print(f"ERROR: Post failed for {os.path.basename(media_to_post)}. Database will not be updated for this run.")
        # Do not update database on failure, and don't delete from Drive
    
    cleanup_temp_folder()

# --- Main Execution Logic ---
async def main():
    print("--- Continuous Telegram Worker ---")

    if not os.path.exists(TEMP_FOLDER):
        os.makedirs(TEMP_FOLDER)
        print(f"Created folder: {TEMP_FOLDER}")

    while True:
        channel = get_next_scheduled_channel()

        if not channel:
            print(f"No channels currently scheduled. Waiting for {IDLE_SLEEP_MINUTES} minutes...")
            await asyncio.sleep(IDLE_SLEEP_MINUTES * 60)
            subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])
            continue

        print("\n----------------------------------------------------")
        print(f"Found next scheduled post:")
        print(f"  >> Channel: {channel['channel_name']}")
        print("----------------------------------------------------")

        # Countdown logic
        while True:
            IST_OFFSET = timedelta(hours=5, minutes=30)
            incorrect_local_time = channel['next_post_time']
            corrected_utc_time = incorrect_local_time - IST_OFFSET
            next_post_time_aware = pytz.utc.localize(corrected_utc_time)
            now_aware = datetime.now(pytz.utc)
            wait_seconds = (next_post_time_aware - now_aware).total_seconds()

            if wait_seconds <= 0:
                print("Time to post!")
                break

            if wait_seconds > RESCHEDULE_THRESHOLD_MINUTES * 60:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print(f"Next post in {minutes}m {seconds}s is over {RESCHEDULE_THRESHOLD_MINUTES} minutes. Running scheduler_telegram.py in {over_time * 60} seconds and restarting...")
                await asyncio.sleep(over_time * 60)
                try:
                    subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])
                    print("Ran scheduler_telegram.py successfully.")
                except subprocess.CalledProcessError as e:
                    print(f"ERROR: Failed to run scheduler_telegram.py: {str(e)}")
                print("Restarting post_on_telegram.py...")
                os.execv(sys.executable, [sys.executable] + sys.argv)
            elif wait_seconds > ACTIVE_COUNTDOWN_SECONDS*60:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print(f"Next post in {minutes}m {seconds}s. Waiting... (Checking every 30s)", end='\r')
                await asyncio.sleep(1)
            else:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print(f"Active countdown: Post in {minutes}m {seconds}s...", end='\r')
                await asyncio.sleep(1)

        # Posting logic
        print(f"Initiating post for {channel['channel_name']}...")
        await process_channel(channel)
        print("Task complete. Looking for the next scheduled post...")
        await asyncio.sleep(2)
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])

if __name__ == "__main__":
    asyncio.run(main())