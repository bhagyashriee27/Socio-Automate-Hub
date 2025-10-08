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

# Hugging Face Transformers for AI caption generation
from transformers import BlipProcessor, BlipForConditionalGeneration
from PIL import Image
import torch

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
ACTIVE_COUNTDOWN_SECONDS = 300
IDLE_SLEEP_MINUTES = 0.3
RESCHEDULE_THRESHOLD_MINUTES = 15
over_time = 1

# In-memory cache for credentials
_credentials_cache = {}

# AI Model for caption generation
processor = None
model = None

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

# --- AI Caption Generation Functions ---
def load_caption_model():
    global processor, model
    try:
        print_step("Loading AI caption model...")
        processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
        model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")
        print_success("AI caption model ready")
    except Exception as e:
        print_error(f"Failed to load AI model: {str(e)}")

def generate_caption_from_image(image_path):
    global processor, model
    
    if processor is None or model is None:
        load_caption_model()
        if processor is None or model is None:
            return get_fallback_caption()
    
    try:
        image = Image.open(image_path).convert('RGB')
        inputs = processor(image, return_tensors="pt")
        
        with torch.no_grad():
            out = model.generate(**inputs, max_length=50, num_beams=5, early_stopping=True)
        
        caption = processor.decode(out[0], skip_special_tokens=True)
        hashtags = generate_smart_hashtags(caption)
        
        final_caption = f"{caption}\n\n{hashtags}"
        print_success(f"Caption: {caption}")
        return final_caption
        
    except Exception as e:
        print_error(f"AI caption failed: {str(e)}")
        return get_fallback_caption()

def generate_caption_from_video(video_path):
    try:
        frame_path = os.path.join(TEMP_FOLDER, "video_frame.jpg")
        
        try:
            ffmpeg.input(video_path, ss=1).output(frame_path, vframes=1).run(overwrite_output=True, quiet=True)
            
            if os.path.exists(frame_path):
                caption = generate_caption_from_image(frame_path)
                try:
                    os.remove(frame_path)
                except:
                    pass
                return caption
            else:
                return get_fallback_caption()
                
        except Exception as e:
            print_error(f"Could not extract video frame: {str(e)}")
            return get_fallback_caption()
            
    except Exception as e:
        print_error(f"Video caption failed: {str(e)}")
        return get_fallback_caption()

def generate_smart_hashtags(caption):
    words = re.findall(r'\b\w+\b', caption.lower())
    
    stop_words = {
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
        'of', 'with', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 
        'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 
        'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 
        'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me',
        'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their'
    }
    
    meaningful_words = []
    for word in words:
        if (word not in stop_words and 
            len(word) > 3 and 
            word.isalpha() and
            word not in meaningful_words):
            meaningful_words.append(word)
    
    hashtags = [f"#{word}" for word in meaningful_words[:8]]
    
    generic_hashtags = [
        "instagram", "photooftheday", "instagood", "picoftheday", 
        "beautiful", "art", "nature", "love", "happy", "life"
    ]
    
    for tag in generic_hashtags:
        if tag not in meaningful_words and len(hashtags) < 15:
            hashtags.append(f"#{tag}")
    
    return " ".join(hashtags[:15])

def get_fallback_caption():
    fallback_captions = [
        "Capturing beautiful moments and sharing them with the world",
        "Life through my lens - every picture tells a story",
        "Finding beauty in everyday moments and sharing them with you",
        "Creative expression through photography and visual storytelling",
        "Exploring the world one photo at a time"
    ]
    
    import random
    base_caption = random.choice(fallback_captions)
    hashtags = "#instagram #photography #instagood #picoftheday #beautiful #art #nature"
    
    return f"{base_caption}\n\n{hashtags}"

def get_auto_caption(media_path, is_video=False):
    try:
        print_step(f"Creating caption for {os.path.basename(media_path)}...")
        
        if is_video:
            caption = generate_caption_from_video(media_path)
        else:
            caption = generate_caption_from_image(media_path)
        
        return caption
        
    except Exception as e:
        print_error(f"Auto-caption failed: {str(e)}")
        return get_fallback_caption()

# --- Database Functions ---
def get_db_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print_error(f"Database connection failed: {str(e)}")
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
    print_success(f"Account updated - Posts left: {posts_left}")

# --- Helper Functions ---
def get_instagram_session(account):
    cl = Client()
    if account['token_sesson'] and account['token_sesson'] != '{}':
        try:
            cl.set_settings(json.loads(account['token_sesson']))
            sleep(2)
            print_success(f"Session restored for {account['username']}")
            return cl
        except Exception as e:
            print_warning(f"Session expired, logging in again: {str(e)}")
    try:
        print_step(f"Logging into Instagram as {account['username']}...")
        cl.login(account['username'], account['passwand'])
        session = cl.get_settings()
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE instagram SET token_sesson = %s WHERE id = %s", (json.dumps(session), account['id']))
        conn.commit()
        cursor.close()
        conn.close()
        print_success(f"Logged in successfully as {account['username']}")
        return cl
    except Exception as e:
        print_error(f"Login failed: {str(e)}")
        return None

def save_drive_token(creds, account_id):
    try:
        conn = get_db_connection()
        if not conn:
            print_error(f"Could not save Drive token: No database connection")
            return False
        cursor = conn.cursor()
        cursor.execute("UPDATE instagram SET token_drive = %s WHERE id = %s", (creds.to_json(), account_id))
        conn.commit()
        cursor.close()
        conn.close()
        print_success("Drive token saved")
        return True
    except Exception as e:
        print_error(f"Failed to save Drive token: {str(e)}")
        return False

def get_drive_credentials(account, max_retries=3):
    global _credentials_cache
    account_id = account['id']
    username = account['username']

    if account_id in _credentials_cache and _credentials_cache[account_id].valid:
        print_success("Using cached Drive credentials")
        return _credentials_cache[account_id]

    creds = None
    if account['token_drive']:
        try:
            token_str = account['token_drive'].strip('"').replace('\\"', '"').replace("\\'", "'")
            token_data = json.loads(token_str)
            creds = Credentials.from_authorized_user_info(token_data, SCOPES)
            print_success("Drive credentials loaded")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print_error(f"Invalid Drive token: {str(e)}")
            creds = None

    if creds and creds.expired and creds.refresh_token:
        for attempt in range(max_retries):
            try:
                creds.refresh(Request())
                print_success("Drive token refreshed")
                if save_drive_token(creds, account_id):
                    _credentials_cache[account_id] = creds
                return creds
            except Exception as e:
                print_warning(f"Token refresh failed (attempt {attempt + 1}/{max_retries}): {str(e)}")
                if attempt < max_retries - 1:
                    sleep(5)
                else:
                    print_error("Max refresh attempts reached")
                    creds = None

    if not creds or not creds.valid:
        if not os.path.exists('credentials.json'):
            print_error("Google Drive credentials file not found")
            return None
        try:
            print_step("Setting up Google Drive access...")
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
            if save_drive_token(creds, account_id):
                _credentials_cache[account_id] = creds
                print_success("Google Drive connected")
            else:
                print_error("Failed to save new Drive token")
                return None
        except Exception as e:
            print_error(f"Google Drive setup failed: {str(e)}")
            return None

    return creds

def extract_folder_id(drive_link):
    if not drive_link:
        return None
    match = re.search(r'folders/([a-zA-Z0-9_-]+)', drive_link)
    if match:
        return match.group(1)
    print_error(f"Invalid Google Drive link format")
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
        print_success(f"Created new folder: {folder_name}")
    else:
        folder_id = folders[0]['id']
        print_info(f"Using existing folder: {folder_name}")

    try:
        # FIX: Add proper permissions to allow file deletion
        permission = {
            'type': 'user',
            'role': 'writer',
            'emailAddress': creds.service_account_email if hasattr(creds, 'service_account_email') else 'user'
        }
        drive_service.permissions().create(fileId=folder_id, body=permission).execute()
        
        folder = drive_service.files().get(fileId=folder_id, fields='webViewLink').execute()
        folder_link = folder.get('webViewLink')
        print_success("Folder permissions set up")
    except Exception as e:
        print_warning(f"Could not set folder permissions: {str(e)}")
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
    print_success(f"Downloaded: {os.path.basename(local_path)}")

def get_oldest_media_file(creds, account):
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
            print_info("Using existing Drive folder")
        except Exception as e:
            print_warning(f"Folder access failed, creating new one: {str(e)}")
            folder_id, folder_link = create_instagram_feed_folder(creds, username)
            conn = get_db_connection()
            if not conn:
                return None, None, None
            cursor = conn.cursor()
            cursor.execute("UPDATE instagram SET google_drive_link = %s WHERE id = %s", (folder_link, account['id']))
            conn.commit()
            cursor.close()
            conn.close()
            print_success("Drive folder updated")
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
        print_success("Drive folder created")

    query = f"'{folder_id}' in parents"
    results = drive_service.files().list(
        q=query, 
        fields="files(id, name, mimeType, createdTime)",
        orderBy="createdTime"
    ).execute()
    files = results.get('files', [])

    if not files:
        print_error("No media files found in Drive folder")
        return None, None, None

    oldest_file = None
    for file in files:
        if file['mimeType'].startswith('image/') or file['mimeType'].startswith('video/'):
            oldest_file = file
            break

    if not oldest_file:
        print_error("No valid image or video files found")
        return None, None, None

    local_path = os.path.join(TEMP_FOLDER, oldest_file['name'])
    print_step(f"Downloading: {oldest_file['name']}")
    download_from_drive(oldest_file['id'], local_path, creds)
    
    is_video = oldest_file['mimeType'].startswith('video/')
    return local_path, oldest_file['id'], is_video

def delete_file_from_drive(file_id, creds):
    """Delete a file from Google Drive with proper permissions"""
    try:
        drive_service = build('drive', 'v3', credentials=creds)
        
        # FIX: First try to get the file to verify permissions
        try:
            file_info = drive_service.files().get(fileId=file_id, fields='id, name, permissions').execute()
            print_info(f"Checking permissions for file deletion...")
        except Exception as e:
            print_error(f"Cannot access file for deletion: {str(e)}")
            return False
        
        # Now delete the file
        drive_service.files().delete(fileId=file_id).execute()
        print_success("File deleted from Google Drive")
        return True
        
    except Exception as e:
        print_error(f"Could not delete file from Drive: {str(e)}")
        print_info("Note: Make sure the Google account has 'Editor' access to the folder")
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
        print_error(f"Video adjustment failed: {str(e)}")
        return False

def post_media(client, media_path, caption, is_video=True):
    try:
        media_name = os.path.basename(media_path)
        full_caption = caption
        
        thumbnail_path = None
        if is_video:
            thumbnail_path = os.path.splitext(media_path)[0] + "_thumb.jpg"
            try:
                ffmpeg.input(media_path, ss=1).output(thumbnail_path, vframes=1).run(overwrite_output=True, quiet=True)
            except ffmpeg.Error:
                thumbnail_path = None
        
        print_step(f"Uploading to Instagram...")
        if is_video:
            client.clip_upload(media_path, caption=full_caption, thumbnail=thumbnail_path)
        else:
            client.photo_upload(media_path, caption=full_caption)
        
        print_success(f"Posted successfully: {media_name}")
        return True
    except Exception as e:
        print_error(f"Upload failed: {str(e)}")
        return False

def cleanup_temp_folder():
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

# --- Main Execution Logic ---
def main():
    print_header("Instagram Auto-Poster")
    print_info("Starting automation service...")
    
    load_caption_model()
    
    if not os.path.exists(TEMP_FOLDER):
        os.makedirs(TEMP_FOLDER)
        print_success(f"Created temp folder: {TEMP_FOLDER}")
    
    while True:
        account = get_next_scheduled_account()
        
        if not account:
            print_info(f"No posts scheduled. Checking again in {IDLE_SLEEP_MINUTES} minutes...")
            sleep(IDLE_SLEEP_MINUTES * 60)
            continue

        print_header("Next Scheduled Post")
        print(f"👤 User: {account.get('user_name', 'N/A')}")
        print(f"📱 Account: {account.get('username', 'N/A')}")
        print(f"⏰ Time: {account['next_post_time'].strftime('%Y-%m-%d %H:%M:%S %Z')}")

        # Countdown logic
        while True:
            IST_OFFSET = timedelta(hours=5, minutes=30)
            incorrect_local_time = account['next_post_time']
            corrected_utc_time = incorrect_local_time - IST_OFFSET
            next_post_time_aware = pytz.utc.localize(corrected_utc_time)
            now_aware = datetime.now(pytz.utc)
            wait_seconds = (next_post_time_aware - now_aware).total_seconds()

            if wait_seconds <= 0:
                print_success("Time to post!")
                break

            if wait_seconds > RESCHEDULE_THRESHOLD_MINUTES * 60:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print_warning(f"Post in {minutes}m {seconds}s - Running scheduler...")
                sleep(over_time * 60)
                try:
                    subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])
                    print_success("Scheduler updated")
                except subprocess.CalledProcessError as e:
                    print_error(f"Scheduler failed: {str(e)}")
                os.execv(sys.executable, [sys.executable] + sys.argv)
            elif wait_seconds > ACTIVE_COUNTDOWN_SECONDS:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print_countdown(f"Next post in {minutes}m {seconds}s - Monitoring...")
                sleep(15)
            else:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print_countdown(f"Posting in {minutes}m {seconds}s...")
                sleep(1)

        # Posting process
        print_header("Processing Media")
        
        client = get_instagram_session(account)
        if not client:
            print_error("Instagram login failed")
            sleep(10)
            continue

        creds = get_drive_credentials(account)
        if not creds:
            print_error("Google Drive access failed")
            update_account_after_post(account['id'])
            sleep(10)
            continue

        media_to_post, drive_file_id, is_video = get_oldest_media_file(creds, account)
        if not media_to_post:
            print_error("No media files available")
            update_account_after_post(account['id'])
            cleanup_temp_folder()
            continue

        print_success(f"Selected: {os.path.basename(media_to_post)}")

        post_path = media_to_post
        if is_video:
            adjusted_path = os.path.join(TEMP_FOLDER, f"adjusted_{os.path.basename(media_to_post)}")
            if adjust_aspect_ratio(media_to_post, adjusted_path):
                post_path = adjusted_path
                print_success("Video optimized for Instagram")

        caption = get_auto_caption(post_path, is_video=is_video)

        print_header("Uploading to Instagram")
        if post_media(client, post_path, caption, is_video=is_video):
            print_header("Cleanup")
            if drive_file_id:
                print_step("Removing file from Google Drive...")
                if delete_file_from_drive(drive_file_id, creds):
                    print_success("File removed from Drive")
                else:
                    print_warning("File posted but could not delete from Drive")
                    print_info("Check folder permissions in Google Drive")
            
            update_account_after_post(account['id'])
        else:
            print_error("Post failed - keeping files in Drive")

        cleanup_temp_folder()
        print_header("Completed")
        print_success("Ready for next post")
        sleep(2)
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])

if __name__ == "__main__":
    main()