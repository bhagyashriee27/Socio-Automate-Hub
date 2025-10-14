import subprocess
import mysql.connector
from datetime import datetime, time, timedelta
import pytz
from time import sleep
import os
import hashlib
import json

# Configuration
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "database": os.getenv("DB_DATABASE"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT"))
}
TIMEZONE = pytz.timezone('Asia/Kolkata')

# Helper Functions
def get_db_connection():
    """Establish connection to the MySQL database."""
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print(f"[ERROR] Database connection failed: {e}")
        return None

def timedelta_to_time(td):
    """Convert timedelta object from DB to a time object."""
    if td is None:
        return None
    total_seconds = int(td.total_seconds())
    return time(total_seconds // 3600, (total_seconds % 3600) // 60, total_seconds % 60)

def get_earliest_post_time(table):
    """Fetch the earliest next_post_time from the specified table."""
    conn = get_db_connection()
    if not conn:
        print(f"[ERROR] Failed to connect to database for table {table}.")
        return None
    cursor = conn.cursor()
    query = f"SELECT MIN(next_post_time) AS earliest_time FROM {table} WHERE selected = 'Yes' AND done = 'No' AND posts_left > 0 AND next_post_time IS NOT NULL"
    cursor.execute(query)
    result = cursor.fetchone()
    cursor.close()
    conn.close()
    return result[0] if result and result[0] else None

def make_aware(dt):
    """Convert naive datetime to timezone-aware datetime."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return TIMEZONE.localize(dt)
    return dt

def get_schedule_hash(start_range, end_range, posts_left, custom_data, daily_range, current_date):
    """Generate a hash to detect schedule changes, including current date."""
    schedule_string = f"{start_range}_{end_range}_{posts_left}_{custom_data}_{daily_range}_{current_date}"
    return hashlib.md5(schedule_string.encode()).hexdigest()

def calculate_initial_schedule(now, start_time, end_time, num_posts, post_daily_range_left):
    """
    Calculate the initial posting schedule for the day for range posts.
    Uses post_daily_range_left if available, otherwise falls back to num_posts.
    For 1 post, schedules at the midpoint of the remaining window.
    For multiple posts, spaces evenly from now to end_time.
    Returns list of datetime objects for each post.
    """
    # If post_daily_range_left is 0, skip range posts
    if post_daily_range_left == 0:
        return []
    
    start_datetime = now.replace(hour=start_time.hour, minute=start_time.minute, second=start_time.second, microsecond=0)
    end_datetime = now.replace(hour=end_time.hour, minute=end_time.minute, second=end_time.second, microsecond=0)
    
    if end_datetime <= start_datetime:
        end_datetime += timedelta(days=1)
    
    # Check if schedule end time has already passed
    if now > end_datetime:
        return []  # Skip range posts if past sch_end_range
    
    current_time = now.time()
    if start_time <= current_time <= end_time and now.date() == start_datetime.date():
        start_datetime = now
    else:
        return []  # Schedule for next day only if explicitly needed
    
    # Use post_daily_range_left if available, otherwise use num_posts
    effective_posts = post_daily_range_left if post_daily_range_left > 0 else num_posts
    
    total_seconds = (end_datetime - start_datetime).total_seconds()
    
    if effective_posts <= 0 or total_seconds <= 0:
        return []
    
    if effective_posts == 1:
        # Schedule single post at midpoint of remaining window
        midpoint_seconds = total_seconds / 2
        post_time = start_datetime + timedelta(seconds=midpoint_seconds)
        if post_time > now:
            return [post_time]
        return []
    
    # Multiple posts: space evenly
    interval_seconds = max(total_seconds / effective_posts, 60)
    post_times = []
    for i in range(effective_posts):
        post_time = start_datetime + timedelta(seconds=interval_seconds * i)
        if post_time > now:
            post_times.append(post_time)
    
    return post_times

# Main Logic
def run_scheduler_once():
    """
    Combined scheduler for Instagram, Telegram, and YouTube.
    Updates number_of_posts and posts_left from custom_schedule_data.
    Reverts 'upload_missed' to 'pending' for range posts AND future datetime posts.
    Sets 'upload_missed' for past datetime posts.
    Prioritizes earliest future scheduled_datetime over range posts.
    Supports post_daily_range_left for dynamic daily posting limits.
    """
    conn = get_db_connection()
    if not conn:
        print("[ERROR] Failed to connect to database. Exiting.")
        return

    cursor = conn.cursor(dictionary=True)
    now = datetime.now(TIMEZONE)
    
    print(f"\nScheduler Run: {now.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print("-" * 50)

    platforms = ['instagram', 'telegram', 'youtube']
    completed_ids = {platform: [] for platform in platforms}
    
    for platform in platforms:
        print(f"\nPlatform: {platform.capitalize()}")
        
        cursor.execute(f"""
            SELECT id, sch_start_range, sch_end_range, posts_left, next_post_time, 
                   number_of_posts, schedule_hash, custom_schedule_data, 
                   post_daily_range, post_daily_range_left, last_reset
            FROM {platform}
        """)
        rows = cursor.fetchall()

        for row in rows:
            row_id = row['id']
            start_time = timedelta_to_time(row['sch_start_range'])
            end_time = timedelta_to_time(row['sch_end_range'])

            if not start_time or not end_time:
                print(f"  ID {row_id}: Missing schedule range. Skipped.")
                continue

            # Check if we need to reset post_daily_range_left for new day
            last_reset_date = row['last_reset'].date() if row['last_reset'] else None
            
            if last_reset_date != now.date():
                # Reset post_daily_range_left for new day
                post_daily_range = row['post_daily_range'] if row['post_daily_range'] is not None else 0
                cursor.execute(f"""
                    UPDATE {platform} SET 
                        post_daily_range_left = %s,
                        last_reset = %s
                    WHERE id = %s
                """, (post_daily_range, now, row_id))
                print(f"  ID {row_id}: Reset post_daily_range_left to {post_daily_range} for new day.")
                post_daily_range_left = post_daily_range
            else:
                post_daily_range_left = row['post_daily_range_left'] if row['post_daily_range_left'] is not None else 0

            custom_data = row['custom_schedule_data']
            data = []
            if custom_data:
                try:
                    data = json.loads(custom_data)
                except json.JSONDecodeError:
                    print(f"  ID {row_id}: Invalid custom_schedule_data JSON. Treated as empty.")
                    data = []

            data_updated = False
            for item in data:
                # Handle RANGE posts: upload_missed → pending (ALWAYS)
                if item.get('schedule_type') == 'range' and item.get('status') == 'upload_missed':
                    item['status'] = 'pending'
                    data_updated = True
                    print(f"  ID {row_id}: Reverted status to 'pending' for range media {item.get('media_name')}.")
                
                # Handle DATETIME posts
                elif item.get('schedule_type') == 'datetime' and item.get('scheduled_datetime'):
                    try:
                        scheduled_dt = datetime.strptime(item['scheduled_datetime'], '%Y-%m-%d %H:%M:%S')
                        scheduled_dt_aware = make_aware(scheduled_dt)
                        
                        # FUTURE datetime: upload_missed → pending
                        if item.get('status') == 'upload_missed' and scheduled_dt_aware > now:
                            item['status'] = 'pending'
                            data_updated = True
                            print(f"  ID {row_id}: Reverted status to 'pending' for future datetime media {item.get('media_name')}.")
                        
                        # PAST datetime: pending → upload_missed
                        elif item.get('status') == 'pending' and scheduled_dt_aware < now:
                            item['status'] = 'upload_missed'
                            data_updated = True
                            print(f"  ID {row_id}: Marked media {item.get('media_name')} as 'upload_missed' (past scheduled time).")
                    
                    except ValueError:
                        print(f"  ID {row_id}: Invalid scheduled_datetime for media {item.get('media_name')}.")

            if data_updated:
                cursor.execute(f"""
                    UPDATE {platform} SET 
                        custom_schedule_data = %s
                    WHERE id = %s
                """, (json.dumps(data), row_id))

            total_media = len(data) if data else 0
            pending_count = sum(1 for item in data if item.get('status') == 'pending') if data else 0

            if total_media != row['number_of_posts'] or pending_count != row['posts_left']:
                cursor.execute(f"""
                    UPDATE {platform} SET 
                        number_of_posts = %s, 
                        posts_left = %s 
                    WHERE id = %s
                """, (total_media, pending_count, row_id))
                print(f"  ID {row_id}: Updated posts: total={total_media}, pending={pending_count}.")

            posts_left = pending_count
            selected = 'Yes' if posts_left > 0 else 'No'
            cursor.execute(f"UPDATE {platform} SET selected = %s WHERE id = %s", (selected, row_id))

            done = 'Yes' if posts_left == 0 else 'No'
            cursor.execute(f"UPDATE {platform} SET done = %s WHERE id = %s", (done, row_id))

            if posts_left == 0:
                completed_ids[platform].append(row_id)
                cursor.execute(f"UPDATE {platform} SET next_post_time = NULL WHERE id = %s", (row_id,))
                continue

            next_post_time_aware = make_aware(row['next_post_time']) if row['next_post_time'] else None
            current_schedule_hash = get_schedule_hash(
                row['sch_start_range'], 
                row['sch_end_range'], 
                posts_left,
                custom_data,
                row['post_daily_range'],
                now.date()
            )

            should_recalculate = False
            reason = ""
            
            if not next_post_time_aware or next_post_time_aware <= now:
                should_recalculate = True
                reason = "no valid next_post_time"
            elif row.get('schedule_hash') != current_schedule_hash:
                should_recalculate = True
                reason = "schedule configuration changed"
            elif next_post_time_aware.date() != now.date():
                should_recalculate = True
                reason = "crossing day boundary"

            if should_recalculate:
                print(f"  ID {row_id}: Recalculating schedule ({reason}).")
                
                pending_datetime_times = []
                pending_range_count = 0
                if data:
                    for item in data:
                        if item.get('status') == 'pending':
                            if item.get('schedule_type') == 'datetime' and item.get('scheduled_datetime'):
                                try:
                                    dt = datetime.strptime(item['scheduled_datetime'], '%Y-%m-%d %H:%M:%S')
                                    dt_aware = make_aware(dt)
                                    if dt_aware > now:
                                        pending_datetime_times.append(dt_aware)
                                except ValueError:
                                    print(f"  ID {row_id}: Invalid scheduled_datetime for media {item.get('media_name')}.")
                            elif item.get('schedule_type') == 'range':
                                pending_range_count += 1
                else:
                    pending_range_count = posts_left

                min_datetime = min(pending_datetime_times) if pending_datetime_times else None
                min_range = None
                 
                # Use post_daily_range_left for scheduling range posts
                daily_range_posts = min(pending_range_count, post_daily_range_left) if post_daily_range_left > 0 else 0
                
                if daily_range_posts > 0:
                    range_post_times = calculate_initial_schedule(now, start_time, end_time, daily_range_posts, post_daily_range_left)
                    if range_post_times:
                        min_range = range_post_times[0]
                        print(f"  ID {row_id}: Range post times: {[pt.strftime('%Y-%m-%d %H:%M:%S %Z') for pt in range_post_times]}")
                
                if min_datetime and min_range:
                    next_post = min(min_datetime, min_range)
                    print(f"  ID {row_id}: Selected {'datetime' if next_post == min_datetime else 'range'} time: {next_post.strftime('%Y-%m-%d %H:%M:%S %Z')}")
                elif min_datetime:
                    next_post = min_datetime
                    print(f"  ID {row_id}: Selected datetime time: {next_post.strftime('%Y-%m-%d %H:%M:%S %Z')}")
                elif min_range:
                    next_post = min_range
                    print(f"  ID {row_id}: Selected range time: {next_post.strftime('%Y-%m-%d %H:%M:%S %Z')}")
                else:
                    next_post = None
                    print(f"  ID {row_id}: No schedulable posts (range: {pending_range_count}, datetime: {len(pending_datetime_times)}, daily_range_left: {post_daily_range_left}).")

                if next_post:
                    cursor.execute(f"""
                        UPDATE {platform} SET 
                            next_post_time = %s, 
                            schedule_hash = %s 
                        WHERE id = %s
                    """, (next_post, current_schedule_hash, row_id))
                    print(f"  ID {row_id}: Set next post time to {next_post.strftime('%Y-%m-%d %H:%M:%S %Z')}.")
                else:
                    cursor.execute(f"""
                        UPDATE {platform} SET 
                            next_post_time = NULL,
                            schedule_hash = %s
                        WHERE id = %s
                    """, (current_schedule_hash, row_id))
                    print(f"  ID {row_id}: No posts scheduled.")
            else:
                print(f"  ID {row_id}: Using existing schedule: {next_post_time_aware.strftime('%Y-%m-%d %H:%M:%S %Z')}.")

        if completed_ids[platform]:
            print(f"  Completed accounts (no posts left): {', '.join(map(str, completed_ids[platform]))}.")

    conn.commit()
    cursor.close()
    conn.close()
    
    print("\nEarliest Post Times:")
    instagram_time = get_earliest_post_time('instagram')
    telegram_time = get_earliest_post_time('telegram')
    youtube_time = get_earliest_post_time('youtube')
    
    print(f"  Instagram: {instagram_time.strftime('%Y-%m-%d %H:%M:%S %Z') if instagram_time else 'None'}")
    print(f"  Telegram: {telegram_time.strftime('%Y-%m-%d %H:%M:%S %Z') if telegram_time else 'None'}")
    print(f"  YouTube: {youtube_time.strftime('%Y-%m-%d %H:%M:%S %Z') if youtube_time else 'None'}")

    if not instagram_time and not telegram_time and not youtube_time:
        print("\nNo posts scheduled. Running all workers...")
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_reel_loop.py")], check=False)
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_on_telegram.py")], check=False)
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_on_youtube.py")], check=False)
    else:
        instagram_time_aware = make_aware(instagram_time) if instagram_time else None
        telegram_time_aware = make_aware(telegram_time) if telegram_time else None
        youtube_time_aware = make_aware(youtube_time) if youtube_time else None
        
        earliest_time = None
        earliest_platform = None
        
        for platform, time_aware in [
            ('Instagram', instagram_time_aware),
            ('Telegram', telegram_time_aware),
            ('YouTube', youtube_time_aware)
        ]:
            if time_aware and (earliest_time is None or time_aware < earliest_time):
                earliest_time = time_aware
                earliest_platform = platform
        
        print(f"\nRunning {earliest_platform} worker for earliest post at {earliest_time.strftime('%Y-%m-%d %H:%M:%S %Z')}...")
        if earliest_platform == 'Instagram':
            subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_reel_loop.py")], check=False)
        elif earliest_platform == 'Telegram':
            subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_on_telegram.py")], check=False)
        elif earliest_platform == 'YouTube':
            subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_on_youtube.py")], check=False)

    print(f"\nScheduler Run Complete: {now.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print("-" * 50)

def run_continuous_scheduler():
    """Run the scheduler continuously with error handling."""
    print("Combined Scheduler Service: Instagram, Telegram, YouTube")
    print(f"Timezone: Asia/Kolkata")
    print(f"Interval: Every 30 seconds (Ctrl+C to stop)")
    print("-" * 50)
    
    while True:
        try:
            run_scheduler_once()
            print(f"Next run in 30 seconds: {datetime.now(TIMEZONE).strftime('%Y-%m-%d %H:%M:%S %Z')}")
            sleep(30)
        except KeyboardInterrupt:
            print("\nScheduler terminated by user.")
            break
        except Exception as e:
            print(f"[ERROR] Scheduler error: {e}")
            print(f"Retrying in 30 seconds: {datetime.now(TIMEZONE).strftime('%Y-%m-%d %H:%M:%S %Z')}")
            sleep(30)

if __name__ == "__main__":
    run_continuous_scheduler()